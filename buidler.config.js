require('dotenv').config()
const { usePlugin } = require('@nomiclabs/buidler/config')
const hooks = require('./scripts/buidler-hooks')

usePlugin('@aragon/buidler-aragon')
usePlugin('@nomiclabs/buidler-solhint')
usePlugin('buidler-gas-reporter')
usePlugin('solidity-coverage')

const getEnvironmentVariable = _envVar =>
  process.env[_envVar]
    ? process.env[_envVar]
    : (
      console.error(
        '✘ Cannot migrate!',
        '✘ Please provide an infura api key as and an',
        '✘ account private key as environment variables:',
        '✘ MAINNET_PRIVATE_KEY',
        '✘ RINKEBY_PRIVATE_KEY',
        '✘ INFURA_KEY'
      ),
      process.exit(1)
    )

module.exports = {
  defaultNetwork: 'localhost',
  networks: {
    localhost: {
      url: 'http://localhost:8545',
    },
    rinkeby: {
      url: `https://rinkeby.infura.io/v3/${getEnvironmentVariable('INFURA_KEY')}`,
      accounts: [getEnvironmentVariable('RINKEBY_PRIVATE_KEY')]
    },
    mainnet: {
      url: `https://mainnet.infura.io/v3/${getEnvironmentVariable('INFURA_KEY')}`,
      accounts: [getEnvironmentVariable('MAINNET_PRIVATE_KEY')],
      gasPrice: 45e9
    }
  },
  solc: {
    version: '0.4.24',
    optimizer: {
      enabled: true,
      runs: 10000,
    },
  },
  gasReporter: {
    enabled: process.env.GAS_REPORTER ? true : false,
  },
  aragon: {
    appServePort: 3001,
    clientServePort: 3000,
    appSrcPath: 'app/',
    appBuildOutputPath: 'dist/',
    hooks,
  },
}
