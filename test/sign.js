const enableVotingFor = (
  _applicant,
  _voter,
  _voteId,
  _support,
  _contractAddress
) =>
  new Promise((_resolve, _reject) => {
    const hash = web3.utils.soliditySha3(
      _applicant, _voter, _voteId, _support, _contractAddress
    ).toString('hex')
    
    // _applicant enables _voter to vote for him
    web3.eth.sign(hash, _applicant, (_err , _res) => {
      !_err ? _resolve(_res) : _reject(_err)
    })
  })

module.exports = {
  enableVotingFor
}