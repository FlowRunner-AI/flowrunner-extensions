const { prepareCoderunnerConfig } = require('../../coderunner')

module.exports = prepareCoderunnerConfig({
  marketplaceProduct: {
    name: 'Fireflies',
  },

  app: {
    model: 'Fireflies Service',
    exclude: [],
  },
})
