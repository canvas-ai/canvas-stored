'use strict';

// Utils
const EE = require('eventemitter2');
const debug = require('debug')('canvas:stored');

// Data ingestion utils
const {
    isJson,
    isFile,
    isBuffer,
    isBinary,
} = require('./utils/common');
const {
    checksumJson,
    checksumBuffer,
    checksumFile,
    checksumFileArray,
} = require('./utils/checksums');

// StoreD caching layer
const Cache = require('./cache');

// StoreD backends
const BackendManager = require('./backends/BackendManager');


/**
 * StoreD
 *
 * GET operations will by default use the local cache, then cycle through the backends in the order
 * submitted in the backend array(using defaultBackend if not provided / hitting index to find the next
 * backend if enabled).
 * Insert operations will first write to the local cache, then add the object to the syncd queue.
 *
 * @class Stored
 */

class Stored extends EE {

    constructor() { }

}

module.exports = Stored;
