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
        await this.sleep();

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
            .map(s => s.trim())
            .filter(Boolean);

        return accounts
            .map(account => {
                const accountType = account[Object.keys(account)[0]];
                const accountIBAN = accountType.alias.find(a => a.type === 'IBAN');
                if (!accountIBAN) {
                    console.log('getAccounts: account %s without IBAN, ignore it for now:', accountType.description);
                    return;
                }

                if (whitelist.length && whitelist.indexOf(accountIBAN.value) === -1) {
                    console.log('getAccounts: ignore %s with IBAN %s', accountType.description, accountIBAN.value);
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
     * @param {moment} since Moment of the timestamp
     * @returns {Promise.<PluginTools.Transaction[]>}
     */
    static async getTransactions (accountId, since) {
        await this.setup();
        await this.sleep();

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

            if (!rawTransactions) {
                break;
            }

            rawTransactions
                .map(payment => payment.Payment)
                .forEach(payment => {
                    if (since.isAfter(payment.updated)) {
                        done = true;
                    }

                    transactions.push(
                        new PluginTools.Transaction({
                            id: payment.id.toString(),
                            time: new Date(payment.created),
                            payeeId: payment.counterparty_alias.display_name || payment.counterparty_alias.iban,
                            memo: payment.merchant_reference || payment.description || null,
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
        await this.sleep();

        // install a new keypair
        await client.install();
        await this.sleep();

        // register this device
        await client.registerDevice('ubud');
        await this.sleep();

        // register a new session
        await client.registerSession();

        // get user id
        let myUserId = await PluginTools.getStore('userId');
        if (!myUserId) {
            await this.sleep();

            const users = await client.getUsers();
            myUserId = users.UserPerson.id;

            await PluginTools.setStore('userId', myUserId);
            console.log('My User ID:', myUserId);
        }

        this.userId = myUserId;
    }


    static async sleep () {
        return new Promise(resolve => {
            setTimeout(() => {
                resolve();
            }, 1000);
        });
    }
};