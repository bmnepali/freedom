if (typeof fdom === 'undefined') {
  fdom = {};
}
fdom.app = fdom.app || {};

/**
 * The external interface for a freedom application.
 * Manages all active channels for the application, and allows
 * proxy objects to be created for them.  Also manages the
 * canonical view of the metadata for the application.
 * @class App.External
 * @extends App
 * @param Hub The freedom Hub to register with.
 * @constructor
 */
fdom.app.External = function(hub) {
  this.config = {
    manifest: 'manifest.json',
    source: 'freedom.js'
  };
  this.hub = hub;
  this.channels = {};
  this.manifest = {};
  this.worker = null;
  this.state = false;
  
  handleEvents(this);
};

/**
 * Configure the App based on global FreeDOM configuration.
 * @method configure
 * @param {Object} config global freedom Properties.
 */
fdom.app.External.prototype.configure = function(config) {
  mixin(this.hub.config, config);
  mixin(this.config, config, true);
};

/**
 * Get a publically visible object for a given Channel.
 * @method getProxy
 * @param {String?} flow The channel to provide a proxy for. If no channel
 *     is specified, the default channel will be used.
 * @returns {fdom.Proxy} a proxy object for the requested flow.
 */
fdom.app.External.prototype.getProxy = function(flow) {
  var channel = this.getChannel(flow);

  var proxy = new fdom.Proxy(channel);
  if (!this.config.exports) {
    this.config.exports = proxy;
  }
  return proxy;
};

/**
 * Get a communication channel for an application.  The Channel
 * is used to pass messages in and out of the application, and
 * specifies one 'link' between freedom modules.
 * @method getChannel
 * @param {String?} flow The identifier for the channel. If none is specified
 *     the default channel will be used.
 * @returns {fdom.Channel} a channel for the requested flow.
 */
fdom.app.External.prototype.getChannel = function(flow) {
  if (!this.manifest || !this.id) {
    this.id = makeAbsolute(this.config.manifest);
    this.loadManifest(this.id);
  }
  
  if (!flow) {
    flow = 'default';
  }
  if (!this.channels[flow]) {
    this.channels[flow] = new fdom.Channel(this, flow);
  }
  return this.channels[flow];
};

/**
 * Load the description of the app.
 * @method loadManifest
 * @param {String} manifest The canonical URL of the application.
 * @private
 */
fdom.app.External.prototype.loadManifest = function(manifest) {
  var ref = new XMLHttpRequest();
  ref.addEventListener('readystatechange', function() {
    if (ref.readyState == 4 && ref.responseText) {
      var resp = {};
      try {
        resp = JSON.parse(ref.responseText);
      } catch(err) {
        console.warn("Failed to load manifest " + manifest + ": " + err);
        this.onManifest();
        return;
      }
      this.onManifest(resp);
    } else if (ref.readyState == 4) {
      console.warn(ref.status);
    }
  }.bind(this), false);
  ref.overrideMimeType('application/json');
  ref.open("GET", manifest, true);
  ref.send();
};

/**
 * Callback for availability of Application Manifest.
 * Registers and starts the application.
 * @param onManifest
 * @param {Object} manifest The application manifest.
 * @private
 */
fdom.app.External.prototype.onManifest = function(manifest) {
  if (manifest && manifest['app'] && manifest['app']['script']) {
    this.manifest = manifest;
    this.hub.register(this);
    this['emit']('manifest');
    this.start();
  } else {
    console.warn(manifest + " does not specify a valid application.");
  }
};

/**
 * Start the application context, and activate a communication channel to the
 * remote javascript execution engine.
 * @method start
 * @private
 */
fdom.app.External.prototype.start = function() {
  if (this.worker) {
    this.worker.terminate();
    this.worker = null;
    this.state = false;
  }
  if (this.config['strongIsolation']) {
    if (typeof (window.Blob) !== typeof (Function)) {
      this.worker = new Worker(this.config.source);
    } else {
      var blob = new Blob([this.config.src], {type: 'text/javascript'});
      this.worker = new Worker(URL.createObjectURL(blob));
    }
  } else {
    this.worker = makeFrame(this.config.src, this.config['inject']);
  }
  this.worker.addEventListener('message', function(msg) {
    if (msg.data.fromApp) {
      this.hub.onMessage(this, msg.data);
    }
  }.bind(this), true);
};

/**
 * Mark the application context ready, and deliver queued messages to the
 * worker process.
 * @method ready
 */
fdom.app.External.prototype.ready = function() {
  this.state = true;
  this['emit']('ready');
};

/**
 * Send a raw message to the application.
 * This interface is expected to be used by channels to send to the application,
 * and by the Hub to manage application lifecycle.
 * @method postMessage
 * @param {Object} msg The message to send.
 */
fdom.app.External.prototype.postMessage = function(msg) {
  if (this.state || (this.worker && msg.sourceFlow == "control")) {
    if (this.config['strongIsolation']) {
      this.worker.postMessage(msg);
    } else {
      // TODO(willscott): posting blindly is insecure.
      this.worker.postMessage(msg, "*");
    }
  } else {
    this['once']('ready', function(m) {
      this.postMessage(m);
    }.bind(this, msg));
  }
};
