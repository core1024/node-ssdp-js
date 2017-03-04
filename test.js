var ssdp = require('./')
var uuid = require('uuid/v4')
uuid = uuid()

var SServer = ssdp.Server

var sserver = new SServer({
  suppressRootDeviceAdvertisement: true,
  passiveResponder: false,
  location: 'http://192.168.2.4:8008/ssdp/device-desc.xml',
  reuseAddr: true,
  ttl: 1,
  headers: {
    'OPT': '"http://schemas.upnp.org/upnp/1/0/"; ns=01',
    'O1-NLS': uuid,
    'X-USER-AGENT': 'redsonic'
  }
})

sserver.addUSN('urn:dial-multiscreen-org:service:dial:1')

sserver.on('message', (msg) => {
  console.warn(msg)
})

sserver.start()
