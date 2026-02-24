const { prepareCoderunnerConfig } = require('../../coderunner')

module.exports = prepareCoderunnerConfig({
  marketplaceProduct: {
    name: 'Telegram',
  },

  app: {
    model: 'Telegram',
    exclude: [],
  },
})