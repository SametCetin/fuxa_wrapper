'use strict';
// Configured by the host adapter before the engine calls loadPlugin.
let enabled = true;
const active = new Set();
module.exports = {
    configure(driver) {
        module.exports.create = (...args) => {
            const comm = driver.create(...args);
            const connect = comm.connect.bind(comm), disconnect = comm.disconnect.bind(comm);
            comm.connect = (...values) => {
                if (!enabled) return Promise.reject(new Error('ADS eklentisi kurulu değil.'));
                active.add(comm);
                return connect(...values);
            };
            comm.disconnect = (...values) => { active.delete(comm); return disconnect(...values); };
            return comm;
        };
    },
    async setEnabled(value) {
        enabled = value;
        if (!value) await Promise.allSettled([...active].map(comm => comm.disconnect()));
    },
};
