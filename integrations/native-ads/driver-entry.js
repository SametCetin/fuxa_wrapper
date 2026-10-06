'use strict';
// Configured by the host adapter before the engine calls loadPlugin.
module.exports = {
    configure(driver) { Object.assign(module.exports, driver); },
};
