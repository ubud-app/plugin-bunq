'use strict';

const PluginTools = module.parent.exports;
const BunqClient = require('@bunq-community/bunq-js-client').default;
const PluginStorage = require('./storage');

const myStorage = new PluginStorage(PluginTools);
const client = new BunqClient(myStorage);

const ENCRYPTION_KEY = '455862556d715638324377507437336a';


new PluginTools.Config({
    id: 'apiKey',
    type: 'password',
    label: 'plugins.label.apiKey'
});
new PluginTools.Config({
    id: 'accounts',
    type: 'text',
    label: 'plugins.label.accounts',
    placeholder: 'IBAN 1, IBAN 2'
});


module.exports = class {
    /**
     * @throws {PluginTools.ConfigurationError|PluginTools.ConfigurationErrors}
     * @returns {Promise.<void>}
     */
    static async validateConfig () {
        if (!PluginTools.config('apiKey')) {
            throw new PluginTools.ConfigurationError({
                field: 'apiKey',
                code: 'empty'
            });
        }
        if (!PluginTools.config('accounts')) {
            throw new PluginTools.ConfigurationError({
                field: 'accounts',
                code: 'empty'
            });
        }

        try {
            await this.setup();
        }
        catch (err) {
            console.log('validateConfig: setup() got error: ', err.response.data);
            throw new PluginTools.ConfigurationErrors([
                {
                    field: 'apiKey',
                    code: 'invalid'
                }
            ]);
        }
    }

    /**
     * @returns {Promise.<PluginTools.Account[]>}
     */
    static async getAccounts () {
        await this.setup();

        let accounts;
        try {
            accounts = await client.api.monetaryAccount.list(this.userId);
        }
        catch (err) {
            console.log('getAccounts: got error: ', err.response.data);
            throw err;
        }

        const whitelist = (PluginTools.config('accounts') || '')
            .split(',')
            .map(s => s.trim());

        return accounts
            .map(account => {
                const accountType = account[Object.keys(account)[0]];
                const accountIBAN = accountType.alias.find(a => a.type === 'IBAN').value;

                if (whitelist.length && whitelist.indexOf(accountIBAN) === -1) {
                    console.log('getAccounts: ignore %s with IBAN %s', accountType.description, accountIBAN);
                    return;
                }

                return new PluginTools.Account({
                    id: accountType.id.toString(),
                    name: accountType.description,
                    type: 'checking',
                    balance: Math.round(accountType.balance.value * 100)
                });
            })
            .filter(account => account);
    }

    /**
     * @param {string} accountId Account id submitted via getAccounts()
     * @param {Moment} since Moment of the timestamp
     * @returns {Promise.<PluginTools.Transaction[]>}
     */
    static async getTransactions (accountId, since) {
        await this.setup();

        const transactions = [];
        let done = false;
        let rawTransactions;
        let oldestId;

        do {
            try {
                rawTransactions = await client.api.payment.list(this.userId, accountId, {older_id: oldestId});
            }
            catch (err) {
                console.log('getTransactions: got error: ', err.response.data);
                throw err;
            }

            if(!rawTransactions) {
                break;
            }

            rawTransactions
                .map(payment => payment.Payment)
                .forEach(payment => {
                    if (since.isAfter(payment.created)) {
                        done = true;
                    }

                    transactions.push(
                        new PluginTools.Transaction({
                            id: payment.id.toString(),
                            time: new Date(payment.created),
                            payeeId: payment.counterparty_alias.display_name || payment.counterparty_alias.iban,
                            memo: payment.description,
                            amount: Math.round(payment.amount.value * 100),
                            status: 'cleared'
                        })
                    );

                    oldestId = payment.id;
                });
        } while (!done);

        return transactions;
    }


    /**
     * Do all the bunq setup stuff…
     *
     * @returns {Promise<void>}
     */
    static async setup () {
        // run the bunq application with our API key
        await client.run(PluginTools.config('apiKey'), [], 'PRODUCTION', ENCRYPTION_KEY);

        // install a new keypair
        await client.install();

        // register this device
        await client.registerDevice('DWIMM Plugin');

        // register a new session
        await client.registerSession();

        // get user id
        let myUserId = await PluginTools.getStore('userId');
        if (!myUserId) {
            const users = await client.getUsers();
            myUserId = users.UserPerson.id;

            await PluginTools.setStore('userId', myUserId);
            console.log('My User ID:', myUserId);
        }

        this.userId = myUserId;
    }
};