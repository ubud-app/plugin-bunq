'use strict';

module.exports = class PluginStorage {
    constructor (PluginTools) {
        /**
         * @var {PluginTools}
         */
        this.tools = PluginTools;
    }

    async get (key) {
        return this.tools.getStore(key);
    }

    async set (key, value) {
        return this.tools.setStore(key, value);
    }

    async remove (key) {
        return this.tools.setStore(key, undefined);
    }
};
