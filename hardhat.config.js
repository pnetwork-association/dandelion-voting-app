require('dotenv').config()
require("@nomiclabs/hardhat-web3")
require('@aragon/buidler-aragon')
require('@nomiclabs/buidler-solhint')
require('@nomiclabs/hardhat-truffle5')
require('buidler-gas-reporter')
require('solidity-coverage')

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: {
    version: '0.4.24',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhat: {},
  },
  mocha: {
    timeout: 100000000
  }
}
