const { assertRevert } = require('@aragon/contract-test-helpers/assertThrow')
const { assertAmountOfEvents } = require('@aragon/contract-test-helpers/assertEvent')
const { getEventAt, getEventArgument, getNewProxyAddress } = require('@aragon/contract-test-helpers/events')
const getBlockNumber = require('@aragon/contract-test-helpers/blockNumber')(web3)
const { NOW } = require('@aragon/contract-test-helpers/time')
const { encodeCallScript } = require('@aragon/contract-test-helpers/evmScript')
const { makeErrorMappingProxy } = require('@aragon/contract-test-helpers/utils')
const { enableVotingFor } = require('./sign')

const ExecutionTarget = artifacts.require('ExecutionTarget')
const Voting = artifacts.require('VotingMock')

const ACL = artifacts.require('ACL')
const Kernel = artifacts.require('Kernel')
const DAOFactory = artifacts.require('DAOFactory')
const EVMScriptRegistryFactory = artifacts.require('EVMScriptRegistryFactory')
const MiniMeToken = artifacts.require('MiniMeToken')

const toBn = (number) => web3.utils.toBN(number)
const bigExp = (x, y) => toBn(x).mul(toBn(10).pow(toBn(y)))

const pct16 = x => bigExp(x, 16)
const createdVoteId = receipt => getEventArgument(receipt, 'StartVote', 'voteId')

const ANY_ADDR = '0xffffffffffffffffffffffffffffffffffffffff'
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const EMPTY_SCRIPT = '0x00000001'
const MIN_OPEN_VOTE_AMOUNT = 200000

const VOTER_STATE = ['ABSENT', 'YEA', 'NAY'].reduce((state, key, index) => {
  state[key] = index
  return state
}, {})


contract('Voting App', ([root, holder1, holder2, holder20, holder29, holder51, holder60, forwarder]) => {
  let votingBase, daoFact, voting, token, executionTarget, acl

  let APP_MANAGER_ROLE
  let CREATE_VOTES_ROLE, MODIFY_SUPPORT_ROLE, MODIFY_QUORUM_ROLE, MODIFY_EXECUTION_DELAY_ROLE, MODIFY_MIN_OPEN_VOTE_AMOUNT_ROLE

  // Error strings
  const errors = makeErrorMappingProxy({
    // aragonOS errors
    APP_AUTH_FAILED: 'APP_AUTH_FAILED',
    INIT_ALREADY_INITIALIZED: 'INIT_ALREADY_INITIALIZED',
    INIT_NOT_INITIALIZED: 'INIT_NOT_INITIALIZED',
    RECOVER_DISALLOWED: 'RECOVER_DISALLOWED',

    // Voting errors
    DANDELION_VOTING_NO_VOTE: 'DANDELION_VOTING_NO_VOTE',
    DANDELION_VOTING_VOTE_ID_ZERO: 'DANDELION_VOTING_VOTE_ID_ZERO',
    DANDELION_VOTING_INIT_PCTS: 'DANDELION_VOTING_INIT_PCTS',
    DANDELION_VOTING_CHANGE_SUPPORT_PCTS: 'DANDELION_VOTING_CHANGE_SUPPORT_PCTS',
    DANDELION_VOTING_CHANGE_QUORUM_PCTS: 'DANDELION_VOTING_CHANGE_QUORUM_PCTS',
    DANDELION_VOTING_INIT_SUPPORT_TOO_BIG: 'DANDELION_VOTING_INIT_SUPPORT_TOO_BIG',
    DANDELION_VOTING_CHANGE_SUPP_TOO_BIG: 'DANDELION_VOTING_CHANGE_SUPP_TOO_BIG',
    DANDELION_VOTING_CAN_NOT_VOTE: 'DANDELION_VOTING_CAN_NOT_VOTE',
    DANDELION_VOTING_CAN_NOT_EXECUTE: 'DANDELION_VOTING_CAN_NOT_EXECUTE',
    DANDELION_VOTING_CAN_NOT_FORWARD: 'DANDELION_VOTING_CAN_NOT_FORWARD',
    DANDELION_VOTING_ORACLE_SENDER_MISSING: 'DANDELION_VOTING_ORACLE_SENDER_MISSING',
    DANDELION_VOTING_ORACLE_SENDER_TOO_BIG: 'DANDELION_VOTING_ORACLE_SENDER_TOO_BIG',
    DANDELION_VOTING_ORACLE_SENDER_ZERO: 'DANDELION_VOTING_ORACLE_SENDER_ZERO',
    DANDELION_VOTING_CAN_NOT_OPEN_VOTE: 'DANDELION_VOTING_CAN_NOT_OPEN_VOTE'
  })

  const duration = 60 * 60 * 24 * 3
  const executionDelay = 0

  before(async () => {
    const kernelBase = await Kernel.new(true) // petrify immediately
    const aclBase = await ACL.new()
    const regFact = await EVMScriptRegistryFactory.new()
    daoFact = await DAOFactory.new(kernelBase.address, aclBase.address, regFact.address)
    votingBase = await Voting.new()


    // Setup constants
    APP_MANAGER_ROLE = await kernelBase.APP_MANAGER_ROLE()
    CREATE_VOTES_ROLE = await votingBase.CREATE_VOTES_ROLE()
    MODIFY_SUPPORT_ROLE = await votingBase.MODIFY_SUPPORT_ROLE()
    MODIFY_QUORUM_ROLE = await votingBase.MODIFY_QUORUM_ROLE()
    MODIFY_EXECUTION_DELAY_ROLE = await votingBase.MODIFY_EXECUTION_DELAY_ROLE()
    MODIFY_MIN_OPEN_VOTE_AMOUNT_ROLE = await votingBase.MODIFY_MIN_OPEN_VOTE_AMOUNT_ROLE()
  })

  beforeEach(async () => {
    const r = await daoFact.newDAO(root)
    const dao = await Kernel.at(getEventArgument(r, 'DeployDAO', 'dao'))
    acl = await ACL.at(await dao.acl())

    await acl.createPermission(root, dao.address, APP_MANAGER_ROLE, root, { from: root })

    const receipt = await dao.newAppInstance('0x1234', votingBase.address, '0x', false, { from: root })
    voting = await Voting.at(getNewProxyAddress(receipt))

    await acl.createPermission(root, voting.address, MODIFY_MIN_OPEN_VOTE_AMOUNT_ROLE, root, { from: root })
    await acl.createPermission(root, voting.address, CREATE_VOTES_ROLE, root, { from: root })
    await acl.grantPermission(holder1, voting.address, CREATE_VOTES_ROLE, { from: root })
    await acl.grantPermission(holder2, voting.address, CREATE_VOTES_ROLE, { from: root })
    await acl.grantPermission(holder20, voting.address, CREATE_VOTES_ROLE, { from: root })
    await acl.grantPermission(holder29, voting.address, CREATE_VOTES_ROLE, { from: root })
    await acl.grantPermission(holder51, voting.address, CREATE_VOTES_ROLE, { from: root })
    await acl.createPermission(ANY_ADDR, voting.address, MODIFY_SUPPORT_ROLE, root, { from: root })
    await acl.createPermission(ANY_ADDR, voting.address, MODIFY_QUORUM_ROLE, root, { from: root })
    await acl.createPermission(ANY_ADDR, voting.address, MODIFY_EXECUTION_DELAY_ROLE, root, { from: root })
  })

  context('normal token supply, common tests', () => {
    const neededSupport = pct16(50)
    const minimumAcceptanceQuorum = pct16(20)

    beforeEach(async () => {
      token = await MiniMeToken.new(ZERO_ADDRESS, ZERO_ADDRESS, 0, 'n', 0, 'n', true) // empty parameters minime

      await voting.initialize(token.address, neededSupport, minimumAcceptanceQuorum, duration, executionDelay, forwarder)
      await voting.changeMinOpenVoteAmount(bigExp(MIN_OPEN_VOTE_AMOUNT, 18), { from: root })

      executionTarget = await ExecutionTarget.new()
    })

    it('fails on reinitialization', async () => {
      await assertRevert(voting.initialize(token.address, neededSupport, minimumAcceptanceQuorum, duration, executionDelay, forwarder), errors.INIT_ALREADY_INITIALIZED)
    })

    it('cannot initialize base app', async () => {
      const newVoting = await Voting.new()
      assert.isTrue(await newVoting.isPetrified())
      await assertRevert(newVoting.initialize(token.address, neededSupport, minimumAcceptanceQuorum, duration, executionDelay, forwarder), errors.INIT_ALREADY_INITIALIZED)
    })

    it('checks it is forwarder', async () => {
      assert.isTrue(await voting.isForwarder())
    })

    it('can change required support', async () => {
      const receipt = await voting.changeSupportRequiredPct(neededSupport.add(toBn(1)))
      assertAmountOfEvents(receipt, 'ChangeSupportRequired')
      assert.equal((await voting.supportRequiredPct()).toString(), neededSupport.add(toBn(1)).toString(), 'should have changed required support')
    })

    it('can change minimum amount to open a vote', async () => {
      const amount = bigExp(MIN_OPEN_VOTE_AMOUNT, 18).add(toBn(1))
      const receipt = await voting.changeMinOpenVoteAmount(amount)
      assertAmountOfEvents(receipt, 'ChangeMinOpenVoteAmount')
      assert.equal((await voting.minOpenVoteAmount()).toString(), amount.toString(), 'should have changed minimum amount to open a vote')
    })

    it('fails changing minimum amount to open a vote', async () => {
      await assertRevert(voting.changeMinOpenVoteAmount('1', { from: holder1 }), errors.APP_AUTH_FAILED)
    })

    it('fails changing required support lower than minimum acceptance quorum', async () => {
      await assertRevert(voting.changeSupportRequiredPct(minimumAcceptanceQuorum.sub(toBn(1))), errors.DANDELION_VOTING_CHANGE_SUPPORT_PCTS)
    })

    it('fails changing required support to 100% or more', async () => {
      await assertRevert(voting.changeSupportRequiredPct(pct16(101)), errors.DANDELION_VOTING_CHANGE_SUPP_TOO_BIG)
      await assertRevert(voting.changeSupportRequiredPct(pct16(100)), errors.DANDELION_VOTING_CHANGE_SUPP_TOO_BIG)
    })

    it('can change minimum acceptance quorum', async () => {
      const receipt = await voting.changeMinAcceptQuorumPct(1)
      assertAmountOfEvents(receipt, 'ChangeMinQuorum')

      assert.equal(await voting.minAcceptQuorumPct(), 1, 'should have changed acceptance quorum')
    })

    it('fails changing minimum acceptance quorum to greater than min support', async () => {
      await assertRevert(voting.changeMinAcceptQuorumPct(neededSupport.add(toBn(1))), errors.DANDELION_VOTING_CHANGE_QUORUM_PCTS)
    })

    it('can change execution delay blocks', async () => {
      const expectedExecutionDelayBlocks = 50
      const receipt = await voting.changeExecutionDelay(expectedExecutionDelayBlocks)
      assertAmountOfEvents(receipt, 'ChangeExecutionDelay')

      assert.equal(await voting.executionDelay(), expectedExecutionDelayBlocks, 'should have changed execution delay blocks')
    })

  })

  for (const decimals of [18]) {
    context(`normal token supply, ${decimals} decimals`, () => {
      const neededSupport = pct16(50)
      const minimumAcceptanceQuorum = pct16(20)

      beforeEach(async () => {
        token = await MiniMeToken.new(ZERO_ADDRESS, ZERO_ADDRESS, 0, 'n', decimals, 'n', true) // empty parameters minime

        await token.generateTokens(holder20, bigExp(20, decimals))
        await token.generateTokens(holder29, bigExp(29, decimals))
        await token.generateTokens(holder51, bigExp(51, decimals))

        await voting.initialize(token.address, neededSupport, minimumAcceptanceQuorum, duration, executionDelay, forwarder)
        await voting.changeMinOpenVoteAmount(bigExp(MIN_OPEN_VOTE_AMOUNT, 18), { from: root })

        executionTarget = await ExecutionTarget.new()
      })

      it('execution scripts can execute multiple actions', async () => {
        const action = { to: executionTarget.address, calldata: executionTarget.contract.methods.execute().encodeABI() }
        const script = encodeCallScript([action, action, action])
        const voteId = createdVoteId(await voting.newVote(script, '', true, { from: holder51 }))
        await voting.mockIncreaseTime(duration + executionDelay)
        await voting.executeVote(voteId)
        assert.equal(await executionTarget.counter(), 3, 'should have executed multiple times')
      })

      it('execution script can be empty', async () => {
        await voting.newVote(encodeCallScript([]), '', true, { from: holder51 })
      })

      it('execution throws if any action on script throws', async () => {
        const action = { to: executionTarget.address, calldata: executionTarget.contract.methods.execute().encodeABI() }
        let script = encodeCallScript([action])
        script = script.slice(0, -2) // remove one byte from calldata for it to fail
        const voteId = createdVoteId(await voting.newVote(script, '', true, { from: holder51 }))
        await voting.mockIncreaseTime(duration + executionDelay)
        await assertRevert(voting.executeVote(voteId))
      })

      it('forwarding creates vote', async () => {
        const action = { to: executionTarget.address, calldata: executionTarget.contract.methods.execute().encodeABI() }
        const script = encodeCallScript([action])
        const voteId = createdVoteId(await voting.forward(script, { from: holder51 }))
        assert.equal(voteId, 1, 'voting should have been created')
      })

      it('ACLOracle canPerform() returns true when no votes have been created', async () => {
        assert.isTrue(await voting.canPerform(holder1, ANY_ADDR, '0x', [holder1]))
      })

      it('should not be able to open a vote because it doesn\'t own the amount needed neither has the permissions', async () => {
        await assertRevert(
          voting.newVote(EMPTY_SCRIPT, 'metadata', true, {
            from: holder60
          }),
          errors.DANDELION_VOTING_CAN_NOT_OPEN_VOTE
        )
      })

      it('should be able to open a vote since it owns the amount needed', async () => {
        await token.generateTokens(holder60, bigExp(MIN_OPEN_VOTE_AMOUNT, 18))
        assert.isFalse(await acl.hasPermission(holder60, voting.address, CREATE_VOTES_ROLE))
        const voteId = createdVoteId(await voting.newVote(EMPTY_SCRIPT, 'metadata', true, {
          from: holder60
        }))
        const { open } = await voting.getVote(voteId)
        assert.isTrue(open)
      })

      context('creating vote', () => {
        let script, voteId, creator, metadata

        beforeEach(async () => {
          const action = {
            to: executionTarget.address,
            calldata: executionTarget.contract.methods.execute().encodeABI()
          }
          script = encodeCallScript([action, action])

          const receipt = await voting.newVote(script, 'metadata', false, { from: holder51 })
          voteId = getEventArgument(receipt, 'StartVote', 'voteId')
          creator = getEventArgument(receipt, 'StartVote', 'creator')
          metadata = getEventArgument(receipt, 'StartVote', 'metadata')
        })

        it('has correct state', async () => {
          const { open, executed, startDate, executionDate, snapshotBlock, supportRequired, minAcceptQuorum, votingPower, yea, nay, script: execScript } = await voting.getVote(voteId)

          assert.isTrue(open, 'vote should be open')
          assert.isFalse(executed, 'vote should not be executed')
          //assert.equal(startDate.toString(), NOW, 'start date should be correct')
          assert.equal(executionDate.toString(), startDate.toNumber() + executionDelay + duration, 'execution date should be correct')
          assert.equal(creator, holder51, 'creator should be correct')
          assert.equal(snapshotBlock.toString(), await getBlockNumber() - 1, 'snapshot block should be correct')
          assert.equal(supportRequired.toString(), neededSupport.toString(), 'required support should be app required support')
          assert.equal(minAcceptQuorum.toString(), minimumAcceptanceQuorum.toString(), 'min quorum should be app min quorum')
          assert.equal(votingPower.toString(), bigExp(100, decimals), 'voting power should be 100')
          assert.equal(yea, 0, 'initial yea should be 0')
          assert.equal(nay, 0, 'initial nay should be 0')
          assert.equal(execScript, script, 'script should be correct')
          assert.equal(metadata, 'metadata', 'should have returned correct metadata')
          assert.equal(await voting.getVoterState(voteId, holder60), VOTER_STATE.ABSENT, 'holder60 should not have voted')
        })

        it('fails getting a vote out of bounds', async () => {
          await assertRevert(voting.getVote(voteId + 1), errors.DANDELION_VOTING_NO_VOTE)
        })

        it('fails getting a vote with id 0', async () => {
          await assertRevert(voting.getVote(0), errors.DANDELION_VOTING_VOTE_ID_ZERO)
        })

        it('changing required support does not affect vote required support', async () => {
          await voting.changeSupportRequiredPct(pct16(70))

          // With previous required support at 50%, vote should be approved
          // with new quorum at 70% it shouldn't have, but since min quorum is snapshotted
          // it will succeed

          await voting.vote(voteId, true, { from: holder51 })
          await voting.vote(voteId, true, { from: holder20 })
          await voting.vote(voteId, false, { from: holder29 })
          await voting.mockIncreaseTime(duration + executionDelay)

          const { supportRequired } = await voting.getVote(voteId)
          assert.equal(supportRequired.toString(), neededSupport.toString(), 'required support in vote should stay equal')
          await voting.executeVote(voteId) // exec doesn't fail
        })

        it('changing min quorum doesnt affect vote min quorum', async () => {
          await voting.changeMinAcceptQuorumPct(pct16(50))

          // With previous min acceptance quorum at 20%, vote should be approved
          // with new quorum at 50% it shouldn't have, but since min quorum is snapshotted
          // it will succeed

          await voting.vote(voteId, true, { from: holder29 })
          await voting.mockIncreaseTime(duration + executionDelay)

          const { minAcceptQuorum } = await voting.getVote(voteId)
          assert.equal(minAcceptQuorum.toString(), minimumAcceptanceQuorum.toString(), 'acceptance quorum in vote should stay equal')
          await voting.executeVote(voteId) // exec doesn't fail
        })

        it('changing delay blocks doesnt affect vote delay blocks', async () => {
          await voting.changeExecutionDelay(30)

          await voting.vote(voteId, true, { from: holder29 })
          await voting.mockIncreaseTime(duration + executionDelay)

          const { startDate, executionDate } = await voting.getVote(voteId)
          const expectedExecutionBlock = startDate.toNumber() + executionDelay + duration
          assert.equal(executionDate.toString(), expectedExecutionBlock.toString(), 'execution blocks in vote should not change')
          await voting.executeVote(voteId) // exec doesn't fail
        })

        it('holder can vote', async () => {
          await voting.vote(voteId, false, { from: holder29 })
          const { nay } = await voting.getVote(voteId)
          const voterState = await voting.getVoterState(voteId, holder29)

          assert.equal(nay.toString(), bigExp(29, decimals).toString(), 'nay vote should have been counted')
          assert.equal(voterState, VOTER_STATE.NAY, 'holder29 should have nay voter status')
        })

        it('uses snapshot balance as vote weight when balance increases after vote start', async () => {
          await token.generateTokens(holder29, bigExp(1, decimals))

          await voting.vote(voteId, true, { from: holder29 })
          const { yea } = await voting.getVote(voteId)

          const currentBalance = await token.balanceOf(holder29)
          assert.equal(yea.toString(), bigExp(29, decimals).toString(), 'snapshot balance should have been added')
          assert.equal(currentBalance.toString(), bigExp(30, decimals).toString(), 'balance should be 30 at current block')
        })

        it('uses current balance as vote weight when balance decreases after vote start', async () => {
          await token.transfer(holder60, bigExp(1, decimals), { from: holder29 })

          await voting.vote(voteId, true, { from: holder29 })
          const { yea } = await voting.getVote(voteId)

          const currentBalance = await token.balanceOf(holder29)
          assert.equal(yea.toString(), bigExp(28, decimals).toString(), 'current balance should have been added')
          assert.equal(currentBalance.toString(), bigExp(28, decimals).toString(), 'balance should be 28 at current block')
        })

        it('throws when voter stake becomes 0 after vote start', async () => {
          await token.transfer(holder60, bigExp(29, decimals), { from: holder29 })
          await assertRevert(voting.vote(voteId, true, { from: holder29 }), errors.DANDELION_VOTING_CAN_NOT_VOTE)
        })

        it('throws when non-holder votes', async () => {
          await assertRevert(voting.vote(voteId, true, { from: holder60 }), errors.DANDELION_VOTING_CAN_NOT_VOTE)
        })

        it('throws when voting after voting closes', async () => {
          await voting.mockIncreaseTime(duration)
          await assertRevert(voting.vote(voteId, true, { from: holder29 }), errors.DANDELION_VOTING_CAN_NOT_VOTE)
        })

        it('can execute if vote is approved with support and quorum and execution delay has passed', async () => {
          await voting.vote(voteId, true, { from: holder29 })
          await voting.vote(voteId, false, { from: holder20 })
          await voting.mockIncreaseTime(duration + executionDelay)
          await voting.executeVote(voteId)
          assert.equal(await executionTarget.counter(), 2, 'should have executed result')
        })

        it('cannot execute vote if not enough quorum met', async () => {
          await voting.vote(voteId, true, { from: holder20 })
          await voting.mockIncreaseTime(duration + executionDelay)
          await assertRevert(voting.executeVote(voteId), errors.DANDELION_VOTING_CAN_NOT_EXECUTE)
        })

        it('cannot execute vote if not support met', async () => {
          await voting.vote(voteId, false, { from: holder29 })
          await voting.vote(voteId, false, { from: holder20 })
          await voting.mockIncreaseTime(duration + executionDelay)
          await assertRevert(voting.executeVote(voteId), errors.DANDELION_VOTING_CAN_NOT_EXECUTE)
        })

        it('cannot execute vote before execution date', async () => {
          // Due to the structure of TimeHelpersMock contract we must subtract the blocks created since vote creation when testing.
          const secondsSinceVoteCreation = 4
          await voting.vote(voteId, true, { from: holder29 })
          await voting.vote(voteId, false, { from: holder20 })
          await voting.mockIncreaseTime(duration + executionDelay - secondsSinceVoteCreation)
          await assertRevert(voting.executeVote(voteId), errors.DANDELION_VOTING_CAN_NOT_EXECUTE)
        })

        it('cannot execute vote twice', async () => {
          await voting.vote(voteId, true, { from: holder51 })
          await voting.mockIncreaseTime(duration + executionDelay)
          await voting.executeVote(voteId)
          await assertRevert(voting.executeVote(voteId), errors.DANDELION_VOTING_CAN_NOT_EXECUTE)
        })

        it('cannot execute unvoted finished vote', async () => {
          await voting.mockIncreaseTime(duration + executionDelay)
          await assertRevert(voting.executeVote(voteId), errors.DANDELION_VOTING_CAN_NOT_EXECUTE)
        })

        it('voter can\'t change vote', async () => {
          await voting.vote(voteId, true, { from: holder29 })
          await assertRevert(voting.vote(voteId, false, { from: holder29 }), errors.DANDELION_VOTING_CAN_NOT_VOTE)
        })

        it('cannot execute unvoted vote before start block', async () => {
          const newVoteId = createdVoteId(await voting.newVote(script, 'metadata', false, { from: holder51 }))
          const { startDate: newVoteStartDate } = await voting.getVote(newVoteId)
          const currentBlock = await voting.getBlockNumberPublic()

          assert(parseInt(newVoteStartDate) > parseInt(currentBlock), 'new vote start block should be ahead of current block')
          await assertRevert(voting.executeVote(newVoteId), errors.DANDELION_VOTING_CAN_NOT_EXECUTE)
        })

        it('increments voteId by 1 for each new vote', async () => {
          const secondVoteId = createdVoteId(await voting.newVote(script, 'metadata', false, { from: holder20 }))
          const thirdVoteId = createdVoteId(await voting.newVote(script, 'metadata', false, { from: holder20 }))

          assert.equal(voteId, 1)
          assert.equal(secondVoteId, 2)
          assert.equal(thirdVoteId, 3)
        })

        it('last yea vote id for voter set to voteId of vote voted for', async () => {
          await voting.vote(voteId, true, { from: holder29 })

          const actualLatestYeaVoteId = await voting.latestYeaVoteId(holder29)
          assert.equal(actualLatestYeaVoteId.toString(), voteId.toString())
        })

        it('last yea vote id for voter not set when voted against', async () => {
          await voting.vote(voteId, false, { from: holder29 })

          const actualLatestYeaVoteId = await voting.latestYeaVoteId(holder29)
          assert.equal(actualLatestYeaVoteId.toString(), 0)
        })

        describe('last yea voteId on second vote', () => {

          let secondVoteId

          beforeEach(async () => {
            secondVoteId = createdVoteId(await voting.newVote(script, 'metadata', false))
          })

          it('updates when voting on a second vote', async () => {
            await voting.vote(voteId, true, { from: holder29 })

            await voting.vote(secondVoteId, true, { from: holder29 })

            const actualLatestYeaVoteId = await voting.latestYeaVoteId(holder29)
            assert.equal(actualLatestYeaVoteId.toString(), secondVoteId.toString())
            assert.notEqual(actualLatestYeaVoteId.toString(), voteId.toString())
          })

          it('doesn\'t update when second voteId less than voted on voteId', async () => {
            await voting.vote(secondVoteId, true, { from: holder29 })

            await voting.vote(voteId, true, { from: holder29 })

            const actualLatestYeaVoteId = await voting.latestYeaVoteId(holder29)
            assert.equal(actualLatestYeaVoteId.toString(), secondVoteId.toString())
            assert.notEqual(actualLatestYeaVoteId.toString(), voteId.toString())
          })
        })

        const itChecksNoRecentPositiveVotesCorrectly = (functionCallingNoRecentPositiveVotes) => {

          it('returns true when not voted in any votes', async () => {
            assert.isTrue(await functionCallingNoRecentPositiveVotes(holder29))
          })

          it('returns true when voted nay on open vote', async () => {
            await voting.vote(voteId, false, { from: holder29 })

            assert.isTrue(await functionCallingNoRecentPositiveVotes(holder29))
          })

          it('returns true when voted yea and vote finished, failed and execution delay passed', async () => {
            await voting.vote(voteId, true, { from: holder20 })
            await voting.vote(voteId, false, { from: holder29 })
            await voting.mockIncreaseTime(duration + executionDelay)

            assert.isTrue(await functionCallingNoRecentPositiveVotes(holder20))
          })

          it('returns false when voted yea and vote finished, failed and before execution delay passed', async () => {
            await voting.vote(voteId, true, { from: holder20 })
            await voting.vote(voteId, false, { from: holder29 })
            await voting.mockIncreaseTime(duration + executionDelay - 4)

            assert.isFalse(await functionCallingNoRecentPositiveVotes(holder20))
          })

          it('returns true when voted yea and vote finished and executed', async () => {
            await voting.vote(voteId, true, { from: holder29 })
            await voting.mockIncreaseTime(duration + executionDelay)
            await voting.executeVote(voteId)

            assert.isTrue(await functionCallingNoRecentPositiveVotes(holder29))
          })

          it('returns false when voted yea and vote finished but not executed', async () => {
            await voting.vote(voteId, true, { from: holder29 })
            await voting.mockIncreaseTime(duration + executionDelay)
            assert.isFalse(await functionCallingNoRecentPositiveVotes(holder29))
          })

          it('returns false when voted yea and vote finished, not executed and before execution period passed', async () => {
            await voting.vote(voteId, true, { from: holder29 })
            await voting.mockIncreaseTime(duration + executionDelay - 2)
            assert.isFalse(await functionCallingNoRecentPositiveVotes(holder29))
          })

          it('returns false when voted yea and vote open', async () => {
            await voting.vote(voteId, true, { from: holder29 })
            assert.isFalse(await functionCallingNoRecentPositiveVotes(holder29))
          })

          it('returns false when voted nay on first vote and yea on second vote', async () => {
            await voting.vote(voteId, false, { from: holder29 })
            assert.isTrue(await functionCallingNoRecentPositiveVotes(holder29))

            const secondVoteId = createdVoteId(await voting.newVote(script, 'metadata', false))
            await voting.vote(secondVoteId, true, { from: holder29 })

            assert.isFalse(await functionCallingNoRecentPositiveVotes(holder29))
          })

          it('returns false when voted yea on open vote and new vote created', async () => {
            await voting.vote(voteId, true, { from: holder29 })
            assert.isFalse(await functionCallingNoRecentPositiveVotes(holder29))

            createdVoteId(await voting.newVote(script, 'metadata', false))

            assert.isFalse(await functionCallingNoRecentPositiveVotes(holder29))
          })

          it('returns false when voted yea on first vote and nay on second vote', async () => {
            await voting.vote(voteId, true, { from: holder29 })
            assert.isFalse(await functionCallingNoRecentPositiveVotes(holder29))

            const secondVoteId = createdVoteId(await voting.newVote(script, 'metadata', false))
            await voting.vote(secondVoteId, false, { from: holder29 })

            assert.isFalse(await functionCallingNoRecentPositiveVotes(holder29))
          })
        }

        describe('ACLOracle canPerform()', () => {

          it('reverts when passed empty address array', async () => {
            await assertRevert(voting.canPerform(ANY_ADDR, ANY_ADDR, '0x', []), errors.DANDELION_VOTING_ORACLE_SENDER_MISSING)
          })

          it('reverts when passed uint is out of range', async () => {
            const outOfRangeAddressAsInt = toBn(2).pow(toBn(160))
            await assertRevert(voting.canPerform(ANY_ADDR, ANY_ADDR, '0x', [outOfRangeAddressAsInt]), errors.DANDELION_VOTING_ORACLE_SENDER_TOO_BIG)
          })

          it('reverts when passed 0 as address', async () => {
            await assertRevert(voting.canPerform(ANY_ADDR, ANY_ADDR, '0x', [0]), errors.DANDELION_VOTING_ORACLE_SENDER_ZERO)
          })

          itChecksNoRecentPositiveVotesCorrectly(
            async (sender) => await voting.canPerform(ANY_ADDR, ANY_ADDR, '0x', [sender]))
        })

        describe('TokenManagerHook _transfer()', () => {

          itChecksNoRecentPositiveVotesCorrectly(
            async (sender) => await voting.onTransfer.call(sender, ANY_ADDR, bigExp(1, 18)))
        })
      })

      it('should be able to vote for a third party', async () => {
        const action = { to: executionTarget.address, calldata: executionTarget.contract.methods.execute().encodeABI() }
        const script = encodeCallScript([action])
        const voteId = createdVoteId(await voting.newVote(script, '', true, { from: root }))

        // holder1 enables holder2 to vote for him
        const signature = await enableVotingFor(holder29, holder1, voteId, true, voting.address)
        await voting.voteFor(voteId, true, signature, {
          from: holder1
        })

        await voting.mockIncreaseTime(duration + executionDelay)
        await voting.executeVote(voteId)
      })

      it('should not be able to vote 2 times for a third party', async () => {
        const action = { to: executionTarget.address, calldata: executionTarget.contract.methods.execute().encodeABI() }
        const script = encodeCallScript([action])
        const voteId = createdVoteId(await voting.newVote(script, '', { from: root }))

        const signature = await enableVotingFor(holder29, holder1, voteId, true, voting.address)
        await voting.voteFor(voteId, true, signature, {
          from: holder1
        })

        await assertRevert(
          voting.voteFor(voteId, true, signature, {
            from: holder1
          }),
          errors.DANDELION_VOTING_CAN_NOT_VOTE
        )
      })

      it('should not be able to vote for a third party because of an invalid signature', async () => {
        const action = { to: executionTarget.address, calldata: executionTarget.contract.methods.execute().encodeABI() }
        const script = encodeCallScript([action])
        const voteId = createdVoteId(await voting.newVote(script, '', true, { from: root }))

        const signature = await enableVotingFor(holder29, holder1, voteId + 1, true, voting.address)
        await assertRevert(
          voting.voteFor(voteId, true, signature, {
            from: holder1
          }),
          errors.DANDELION_VOTING_CAN_NOT_VOTE
        )
      })
    })
  }

  context('wrong initializations', () => {
    beforeEach(async () => {
      token = await MiniMeToken.new(ZERO_ADDRESS, ZERO_ADDRESS, 0, 'n', 0, 'n', true) // empty parameters minime
    })

    it('fails if min acceptance quorum is greater than min support', async () => {
      const neededSupport = pct16(20)
      const minimumAcceptanceQuorum = pct16(50)
      await assertRevert(voting.initialize(token.address, neededSupport, minimumAcceptanceQuorum, duration, executionDelay, forwarder), errors.DANDELION_VOTING_INIT_PCTS)
    })

    it('fails if min support is 100% or more', async () => {
      const minimumAcceptanceQuorum = pct16(20)
      await assertRevert(voting.initialize(token.address, pct16(101), minimumAcceptanceQuorum, duration, executionDelay, forwarder), errors.DANDELION_VOTING_INIT_SUPPORT_TOO_BIG)
      await assertRevert(voting.initialize(token.address, pct16(100), minimumAcceptanceQuorum, duration, executionDelay, forwarder), errors.DANDELION_VOTING_INIT_SUPPORT_TOO_BIG)
    })
  })

  context('empty token', () => {
    const neededSupport = pct16(50)
    const minimumAcceptanceQuorum = pct16(20)

    beforeEach(async () => {
      token = await MiniMeToken.new(ZERO_ADDRESS, ZERO_ADDRESS, 0, 'n', 0, 'n', true) // empty parameters minime

      await voting.initialize(token.address, neededSupport, minimumAcceptanceQuorum, duration, executionDelay, forwarder)
    })

    it('prevents voting if token has no holder', async () => {
      const voteId = createdVoteId(await voting.newVote(EMPTY_SCRIPT, 'metadata', true))

      const { open: canVote } = await voting.getVote(voteId)
      assert.isFalse(canVote)
      await assertRevert(voting.vote(voteId, true, { from: holder1 }), errors.DANDELION_VOTING_CAN_NOT_VOTE)
    })
  })

  context('token supply = 1', () => {
    const neededSupport = pct16(50)
    const minimumAcceptanceQuorum = pct16(20)

    beforeEach(async () => {
      token = await MiniMeToken.new(ZERO_ADDRESS, ZERO_ADDRESS, 0, 'n', 0, 'n', true) // empty parameters minime

      await token.generateTokens(holder1, 1)

      await voting.initialize(token.address, neededSupport, minimumAcceptanceQuorum, duration, executionDelay, forwarder)
    })

    it('new vote cannot be executed after only possible voter has voted', async () => {
      // Account creating vote does not have any tokens and therefore doesn't vote
      const voteId = createdVoteId(await voting.newVote(EMPTY_SCRIPT, 'metadata', true))

      assert.isFalse(await voting.canExecute(voteId), 'vote cannot be executed')

      await voting.vote(voteId, true, { from: holder1 })

      const { open, executed } = await voting.getVote(voteId)

      assert.isTrue(open, 'vote should be open')
      assert.isFalse(executed, 'vote should not have been executed')
    })
  })

  context('token supply = 3', () => {
    const neededSupport = pct16(34)
    const minimumAcceptanceQuorum = pct16(20)

    beforeEach(async () => {
      token = await MiniMeToken.new(ZERO_ADDRESS, ZERO_ADDRESS, 0, 'n', 0, 'n', true) // empty parameters minime

      await token.generateTokens(holder1, 1)
      await token.generateTokens(holder2, 2)

      await voting.initialize(token.address, neededSupport, minimumAcceptanceQuorum, duration, executionDelay, forwarder)
    })

    it('new vote cannot be executed before holder2 voting', async () => {
      const voteId = createdVoteId(await voting.newVote(EMPTY_SCRIPT, 'metadata', true))

      assert.isFalse(await voting.canExecute(voteId), 'vote cannot be executed')

      await voting.vote(voteId, true, { from: holder1 })
      await voting.vote(voteId, true, { from: holder2 })

      const { open, executed } = await voting.getVote(voteId)

      assert.isTrue(open, 'vote should be open')
      assert.isFalse(executed, 'vote should not have been executed')
    })

    it('creating vote as holder2 does not execute vote', async () => {
      const voteId = createdVoteId(await voting.newVote(EMPTY_SCRIPT, 'metadata', true, { from: holder2 }))
      const { open, executed } = await voting.getVote(voteId)

      assert.isTrue(open, 'vote should be open')
      assert.isFalse(executed, 'vote should not have been executed')
    })
  })

  context('changing token supply', () => {
    const neededSupport = pct16(50)
    const minimumAcceptanceQuorum = pct16(20)

    beforeEach(async () => {
      token = await MiniMeToken.new(ZERO_ADDRESS, ZERO_ADDRESS, 0, 'n', 0, 'n', true) // empty parameters minime

      await token.generateTokens(holder1, 1)
      await token.generateTokens(holder2, 1)

      await voting.initialize(token.address, neededSupport, minimumAcceptanceQuorum, duration, executionDelay, forwarder)
    })

    it('uses the correct snapshot value if tokens are minted afterwards', async () => {
      // Create vote and afterwards generate some tokens
      const voteId = createdVoteId(await voting.newVote(EMPTY_SCRIPT, 'metadata', true))
      await token.generateTokens(holder2, 1)

      const { snapshotBlock } = await voting.getVote(voteId)

      // Generating tokens advanced the block by one
      assert.equal(snapshotBlock.toString(), await getBlockNumber() - 2, 'snapshot block should be correct')
    })

    it('uses the correct snapshot value if tokens are minted in the same block', async () => {
      // Create vote and generate some tokens in the same transaction
      // Requires the voting mock to be the token's owner
      await token.changeController(voting.address)
      const voteId = createdVoteId(await voting.newTokenAndVote(holder2, 1, 'metadata'))

      const { snapshotBlock } = await voting.getVote(voteId)

      assert.equal(snapshotBlock.toString(), await getBlockNumber() - 1, 'snapshot block should be correct')
    })
  })

  context('before init', () => {
    it('fails to forward actions before initialization', async () => {
      const action = { to: executionTarget.address, calldata: executionTarget.contract.methods.execute().encodeABI() }
      const script = encodeCallScript([action])
      await assertRevert(voting.forward(script, { from: holder51 }), errors.DANDELION_VOTING_CAN_NOT_FORWARD)
    })
  })

  context('isValuePct unit test', async () => {
    it('tests total = 0', async () => {
      const result1 = await voting.isValuePct(0, 0, pct16(50))
      assert.equal(result1, false, 'total 0 should always return false')
      const result2 = await voting.isValuePct(1, 0, pct16(50))
      assert.equal(result2, false, 'total 0 should always return false')
    })

    it('tests value = 0', async () => {
      const result1 = await voting.isValuePct(0, 10, pct16(50))
      assert.equal(result1, false, 'value 0 should false if pct is non-zero')
      const result2 = await voting.isValuePct(0, 10, 0)
      assert.equal(result2, false, 'value 0 should return false if pct is zero')
    })

    it('tests pct ~= 100', async () => {
      const result1 = await voting.isValuePct(10, 10, pct16(100).sub(toBn(1)))
      assert.equal(result1, true, 'value 10 over 10 should pass')
    })

    it('tests strict inequality', async () => {
      const result1 = await voting.isValuePct(10, 20, pct16(50))
      assert.equal(result1, false, 'value 10 over 20 should not pass for 50%')

      const result2 = await voting.isValuePct(pct16(50).sub(toBn(1)), pct16(100), pct16(50))
      assert.equal(result2, false, 'off-by-one down should not pass')

      const result3 = await voting.isValuePct(pct16(50).add(toBn(1)), pct16(100), pct16(50))
      assert.equal(result3, true, 'off-by-one up should pass')
    })
  })
})
