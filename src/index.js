const {
  BaseKonnector,
  requestFactory,
  signin,
  scrape,
  log,
  utils
} = require('cozy-konnector-libs')
const request = requestFactory({
  cheerio: true,
  json: false,
  jar: true
})

const VENDOR = 'template'
const baseUrl = 'http://books.toscrape.com'

module.exports = new BaseKonnector(start)

async function start(fields, cozyParameters) {
  log('info', 'Authenticating ...')
  if (cozyParameters) log('debug', 'Found COZY_PARAMETERS')
  await authenticate(fields.login, fields.password)
  log('info', 'Successfully logged in')
  log('info', 'Fetching the list of documents')
  const $ = await request(`${baseUrl}/index.html`)
  log('info', 'Parsing list of documents')
  const documents = await parseDocuments($)

  log('info', 'Saving data to Cozy')
  await this.saveBills(documents, fields, {
    // This is a bank identifier which will be used to link bills to bank operations. These
    // identifiers should be at least a word found in the title of a bank operation related to this
    // bill. It is not case sensitive.
    identifiers: ['books']
  })
}

function authenticate(username, password) {
  return signin({
    url: `http://quotes.toscrape.com/login`,
    formSelector: 'form',
    formData: { username, password },
    validate: (statusCode, $, fullResponse) => {
      log(
        'debug',
        fullResponse.request.uri.href,
        'not used here but should be useful for other connectors'
      )
      if ($(`a[href='/logout']`).length === 1) {
        return true
      } else {
        log('error', $('.error').text())
        return false
      }
    }
  })
}

function parseDocuments($) {
  const docs = scrape(
    $,
    {
      title: {
        sel: 'h3 a',
        attr: 'title'
      },
      amount: {
        sel: '.price_color',
        parse: normalizePrice
      },
      fileurl: {
        sel: 'img',
        attr: 'src',
        parse: src => `${baseUrl}/${src}`
      }
    },
    'article'
  )
  return docs.map(doc => ({
    ...doc,
    date: new Date(),
    currency: 'EUR',
    filename: `${utils.formatDate(new Date())}_${VENDOR}_${doc.amount.toFixed(
      2
    )}EUR${doc.vendorRef ? '_' + doc.vendorRef : ''}.jpg`,
    vendor: VENDOR,
    metadata: {
      importDate: new Date(),
      version: 1
    }
  }))
}

function normalizePrice(price) {
  return parseFloat(price.replace('£', '').trim())
}
