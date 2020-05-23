/* eslint no-console: off */

const request = require('request-promise')
const cheerio = require('cheerio')
const fs = require('fs')
const path = require('path')

console.log(
  'Getting the list of providers and the corresponding urls and names'
)

request('https://coopcycle.org/fr/').then(body => {
  const $ = cheerio.load(body)
  const cityDropdown = $('#city-dropdown')

  if (!cityDropdown) {
    throw new Error('Failed to get the list of available providers')
  }

  const providers = cityDropdown
    .find('option')
    .map(function() {
      const baseUrl = $(this).attr('value')
      const label = $(this).text()

      if (baseUrl && label) {
        return { baseUrl, label }
      }
    })
    .get()
  providers.sort((a, b) => a.label.localeCompare(b.label))

  const re = /^([^(]+) \(([^)]+)/
  const manifestConfig = []
  const byIndex = {}
  let index = 1
  for (const { baseUrl, label } of providers) {
    const match = re.exec(label)
    if (!match) {
      throw new Error(`Failed to match provider details: ${label}`)
    }

    const city = match[1]
    const name = match[2]
    const strIndex = index.toString()

    byIndex[strIndex] = { city, name, baseUrl }
    manifestConfig.push({
      name: label,
      value: strIndex
    })
    index++
  }

  const providersFilePath = path.join(__dirname, '../providers.json')
  fs.writeFileSync(providersFilePath, JSON.stringify(byIndex, null, 2))

  console.log(`The list of providers is written in ${providersFilePath}`)

  manifestConfig.sort((a, b) => a.name.localeCompare(b.name))
  const manifestFilePath = path.join(__dirname, '../manifestConfig.json')
  fs.writeFileSync(manifestFilePath, JSON.stringify(manifestConfig, null, 2))

  console.log(`The manifest configuration is written in ${manifestFilePath}`)
})
