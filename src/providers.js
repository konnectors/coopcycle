/* eslint no-console: off */

const request = require('request-promise')
const cheerio = require('cheerio')
const fs = require('fs')
const path = require('path')

const providersFilePath = path.join(__dirname, '../providers.json')
const manifestFilePath = path.join(__dirname, '../manifestConfig.json')

run()

async function run() {
  const currentProviders = loadCurrentProviders()
  const providers = await fetchProviders()

  const byIndex = buildProvidersList(currentProviders, providers)
  fs.writeFileSync(providersFilePath, JSON.stringify(byIndex, null, 2))
  console.log(`The list of providers is written in ${providersFilePath}`)

  const manifestConfig = buildManifestConfig(byIndex)
  fs.writeFileSync(manifestFilePath, JSON.stringify(manifestConfig, null, 2))
  console.log(`The manifest configuration is written in ${manifestFilePath}`)
}

function loadCurrentProviders() {
  console.log('Loading the current list of providers')

  return fs.existsSync(providersFilePath)
    ? JSON.parse(fs.readFileSync(providersFilePath))
    : {}
}

async function fetchProviders() {
  console.log(
    'Fetching the updated list of providers and the corresponding urls and names'
  )

  const body = await request('https://coopcycle.org/fr/')
  const $ = cheerio.load(body)
  const cityDropdown = $('#city-dropdown')

  if (!cityDropdown) {
    throw new Error('Failed to get the list of available providers')
  }

  return cityDropdown
    .find('option')
    .map(function() {
      const baseUrl = $(this).attr('value')
      const label = $(this).text()

      if (baseUrl && label) {
        return { baseUrl, label }
      }
    })
    .get()
}

// Helpers

function existingProviderIndex(list, provider) {
  const entries = Object.entries(list)
  const existing = entries.find(entry => {
    // eslint-disable-next-line no-unused-vars
    const [strIndex, { baseUrl }] = entry
    return baseUrl === provider.baseUrl
  })
  return existing && existing[0]
}

function getProviderDetails(label) {
  const re = /^([^(]+) \(([^)]+)/
  const match = re.exec(label)
  if (!match) {
    throw new Error(`Failed to match provider details: ${label}`)
  }

  return {
    city: match[1],
    name: match[2]
  }
}

function buildProvidersList(currentProviders, providers) {
  const byIndex = {}

  let index = Object.keys(currentProviders).length + 1 // We use a 1 based index
  for (const { baseUrl, label } of providers) {
    const { city, name } = getProviderDetails(label)

    const strIndex =
      existingProviderIndex(currentProviders, {
        baseUrl
      }) || (index++).toString()
    byIndex[strIndex] = { label, city, name, baseUrl }
  }

  return byIndex
}

function buildManifestConfig(providersList) {
  return Object.entries(providersList)
    .map(([strIndex, { label }]) => ({
      name: label,
      value: strIndex
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
