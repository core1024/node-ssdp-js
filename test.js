var Client = require('./index').Client
var Server = require('./index').Server

var client = new Client({
  reuseAddr: true
})

client.on('response', (response) => {
  console.warn(response)
})

// client.browse('urn:dial-multiscreen-org:service:dial:1')

var server = new Server({
  reuseAddr: true,
  location: 'http://192.168.2.10:8008/ssdp/device-desc.xml',
  suppressRootDeviceAdvertisement: true
})

server.on('error', (obj) => {
  console.warn(obj)
})

server.advertise('urn:dial-multiscreen-org:service:dial:1')
