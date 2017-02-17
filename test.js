var Client = require('./index').Client

var client = new Client({
  reuseAddr: true
})

client.on('response', (response) => {
  console.warn(response)
})

client.browse('urn:dial-multiscreen-org:service:dial:1')
