const packageJson = require('./package.json')

const config = {
  ...packageJson.build,
}

if (process.env.A8A_APP_VERSION) {
  config.win = {
    ...config.win,
    artifactName: `\${productName}-Setup-${process.env.A8A_APP_VERSION}.\${ext}`,
  }
}

module.exports = config
