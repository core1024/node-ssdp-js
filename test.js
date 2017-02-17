var Client = require('./index').Client

var client = new Client()
client.on('msearch', () => {
  console.log('search')
})
client.search('ssdp:all')
