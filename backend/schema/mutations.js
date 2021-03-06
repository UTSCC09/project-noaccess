const graphql = require('graphql');
const HexagonUser = require('../models/HexagonUser');
const SecureRecord = require('../models/SecureRecord');
const WebsiteCredentials = require('../models/WebsiteCredentials');
const Share = require('../models/Share');
const Seed = require('../models/Seed');
const Note = require('../models/Note');
const CryptoService = require('hexagon-shared/services/CryptoService');
const crypto = require('crypto').webcrypto;
const parser = require('hexagon-shared/utils/parser');
const cryptoService = new CryptoService(crypto);
const sanitize = require('mongo-sanitize');
const { trusted } = require('mongoose');
const bcrypt = require('bcrypt');
const formData = require('form-data');
const Mailgun = require('mailgun.js');
const mailgun = new Mailgun(formData);
const { SecureRecordType, ShareType } = require('./types');

const {
    GraphQLObjectType,
    GraphQLString,
    GraphQLNonNull,
    GraphQLBoolean,
    GraphQLError,
} = graphql;

const DOMAIN = 'hexagon-web.xyz';
const mailKey = process.env.MAILGUN_API_KEY ?? '';
const mg = mailKey
    ? mailgun.client({ username: 'hexagon-server', key: mailKey })
    : null;
if (!mg) console.log('emails disabled');

/**
 * Throws an error based on the error and status code
 * @param {any} err the error
 * @param {any} status the status
 * @returns {any} GraphQLError
 */
const throwDBError = (err, status) => {
    throw new GraphQLError('Custom error', {
        extensions: { ...err, status: status ?? 500 },
    });
};

/**
 * Extracts and returns data related to the record model
 * @param {any} recordModel record model
 * @returns {any} data related to the recordModel
 */
const extractRecord = (recordModel) => {
    const record = recordModel.toObject();
    return { ...record, owners: record.owners.map((owner) => owner.username) };
};

/**
 * Series of mutations for adding records to the database, updating passwords
 * and already existing data, creating shares, and deleting objects from the database
 */
const Mutation = new GraphQLObjectType({
    name: 'Mutation',
    fields: {
        /**
         * Attempts to create a secure record with the given arguments, returns
         * the newly created record on success
         * @param {GraphQLString} name website url
         * @param {GraphQLString} username username for the website
         * @param {GraphQLString} password password for the website
         * @param {GraphQLString} key key used for encryption
         * @param {GraphQLString} masterUsername username for the hexagon user
         * @returns {any} newly created record data
         */
        addWebsiteCredential: {
            type: SecureRecordType,
            args: {
                name: { type: new GraphQLNonNull(GraphQLString) },
                username: { type: new GraphQLNonNull(GraphQLString) },
                password: { type: new GraphQLNonNull(GraphQLString) },
                key: { type: new GraphQLNonNull(GraphQLString) },
                masterUsername: { type: new GraphQLNonNull(GraphQLString) },
            },
            resolve: async (parent, args, context) => {
                const secureRecord = await new SecureRecord({
                    name: args.name,
                    key: args.key,
                    recordId: null,
                    uid: context.token.uid,
                    type: 'account',
                }).save();
                const credential = await new WebsiteCredentials({
                    username: args.username,
                    password: args.password,
                    owners: [
                        {
                            username: args.masterUsername,
                            secureRecordId: secureRecord._id,
                        },
                    ],
                }).save();
                secureRecord.recordId = credential._id;
                await secureRecord.save();
                return {
                    ...secureRecord.toObject(),
                    credential: extractRecord(credential),
                };
            },
        },
        /**
         * Attempts to create a secure record with the given arguments, returns
         * the newly created record on success
         * @param {GraphQLString} title title of the note
         * @param {GraphQLString} note content of the note
         * @param {GraphQLString} key key used for encryption
         * @param {GraphQLString} masterUsername username for the hexagon user
         * @returns {any} newly created record data
         */
        addNote: {
            type: SecureRecordType,
            args: {
                title: { type: new GraphQLNonNull(GraphQLString) },
                note: { type: new GraphQLNonNull(GraphQLString) },
                key: { type: new GraphQLNonNull(GraphQLString) },
                masterUsername: { type: new GraphQLNonNull(GraphQLString) },
            },
            resolve: async (parent, args, context) => {
                const secureRecord = await new SecureRecord({
                    name: null,
                    key: args.key,
                    recordId: null,
                    uid: context.token.uid,
                    type: 'note',
                }).save();
                const note = await new Note({
                    title: args.title,
                    note: args.note,
                    owners: [
                        {
                            username: args.masterUsername,
                            secureRecordId: secureRecord._id,
                        },
                    ],
                }).save();
                secureRecord.recordId = note._id;
                await secureRecord.save();
                return {
                    ...secureRecord.toObject(),
                    note: extractRecord(note),
                };
            },
        },
        /**
         * Attempts to create a secure record with the given arguments, returns
         * the newly created record on success
         * @param {GraphQLString} name website url
         * @param {GraphQLString} username username for the website
         * @param {GraphQLString} seed MFA seed for the website
         * @param {GraphQLString} key key used for encryption
         * @param {GraphQLString} masterUsername username for the hexagon user
         * @returns {any} newly created record data
         */
        addSeed: {
            type: SecureRecordType,
            args: {
                name: { type: new GraphQLNonNull(GraphQLString) },
                username: { type: new GraphQLNonNull(GraphQLString) },
                seed: { type: new GraphQLNonNull(GraphQLString) },
                key: { type: new GraphQLNonNull(GraphQLString) },
                masterUsername: { type: new GraphQLNonNull(GraphQLString) },
            },
            resolve: async (parent, args, context) => {
                const secureRecord = await new SecureRecord({
                    name: args.name,
                    key: args.key,
                    recordId: null,
                    uid: context.token.uid,
                    type: 'seed',
                }).save();
                const seed = await new Seed({
                    username: args.username,
                    seed: args.seed,
                    owners: [
                        {
                            username: args.masterUsername,
                            secureRecordId: secureRecord._id,
                        },
                    ],
                }).save();
                secureRecord.recordId = seed._id;
                await secureRecord.save();
                return {
                    ...secureRecord.toObject(),
                    credential: extractRecord(seed),
                };
            },
        },
        /**
         * Attempts to create a share record with the given arguments, returns
         * the newly created share object on success
         * @param {GraphQLString} secureRecordId points to secure record
         * @param {GraphQLString} receiver the user who you wish to add as an owner
         * @param {GraphQLString} key key used for encryption
         * @returns {any} newly created share data
         */
        addShare: {
            type: ShareType,
            args: {
                secureRecordId: { type: new GraphQLNonNull(GraphQLString) },
                receiver: { type: new GraphQLNonNull(GraphQLString) },
                key: { type: new GraphQLNonNull(GraphQLString) },
            },
            resolve: async (parent, args, context) => {
                if (!parser.isEmail(args.receiver))
                    throwDBError({ receiver: 'Invalid format' }, 400);
                const secureRecord = await SecureRecord.findOne({
                    _id: args.secureRecordId,
                });

                if (!secureRecord)
                    throwDBError({ secureRecordId: 'Could not find' }, 404);
                if (secureRecord.uid != context.token.uid)
                    throwDBError({ secureRecordId: 'Unauthorized' }, 403);

                const shareSecret = cryptoService.generatePlainSecret();
                const [encryptedReceiver] = await cryptoService.encryptData(
                    [args.receiver],
                    args.key
                );
                const [encryptedKey] = await cryptoService.encryptSecrets(
                    [args.key],
                    shareSecret
                );

                const share = await new Share({
                    type: secureRecord.type,
                    name: secureRecord.name,
                    recordId: secureRecord.recordId,
                    receiver: encryptedReceiver,
                    key: encryptedKey,
                }).save();

                const shareId = encodeURIComponent(share._id);
                const shareKey = encodeURIComponent(shareSecret);
                const nextLocation = encodeURIComponent(
                    '/app/' +
                        (share.type === 'account'
                            ? 'credentials'
                            : share.type === 'seed'
                            ? 'mfa'
                            : 'notes')
                );
                const share_link = `https://hexagon-web.xyz/app/share?shareId=${shareId}&shareKey=${shareKey}&next=${nextLocation}`;
                const sender = context.token.username;
                const share_type =
                    share.type === 'account'
                        ? 'credential'
                        : share.type === 'seed'
                        ? 'MFA credential'
                        : 'note';

                const mailgunData = {
                    from: 'Hexagon Security Team <noreply@hexagon-web.xyz>',
                    to: args.receiver,
                    subject: 'Hexagon Share Invitation',
                    template: 'send_share',
                    'h:X-Mailgun-Variables': JSON.stringify({
                        sender,
                        share_type,
                        share_link,
                    }),
                };
                if (mg) await mg.messages.create(DOMAIN, mailgunData);

                return share;
            },
        },
        /**
         * Attempts to update an existing note record with a new title and content,
         * throws an error on failure
         * @param {GraphQLString} title updates with the new title
         * @param {GraphQLString} note updates with the new note content
         * @param {GraphQLString} secureRecordId points to the note record to be updated
         * @returns {any} newly created note data
         */
        updateNote: {
            type: SecureRecordType,
            args: {
                title: { type: new GraphQLNonNull(GraphQLString) },
                note: { type: new GraphQLNonNull(GraphQLString) },
                secureRecordId: { type: new GraphQLNonNull(GraphQLString) },
            },
            resolve: async (parent, args, context) => {
                const secureRecord = await SecureRecord.findOne({
                    _id: args.secureRecordId,
                });
                if (!secureRecord)
                    throwDBError({ secureRecordId: 'Could not find' }, 404);
                if (secureRecord.uid != context.token.uid)
                    throwDBError({ secureRecordId: 'Unauthorized' }, 403);
                const note = await Note.findOne({
                    _id: secureRecord.recordId,
                });
                if (!note) throwDBError({ secureRecordId: 'Corrupted' }, 410);

                note.lastModified = new Date();
                note.title = args.title;
                note.note = args.note;
                const updatedNote = await note.save();
                return {
                    ...secureRecord.toObject(),
                    note: extractRecord(updatedNote),
                };
            },
        },
        /**
         * Attempts to update an existing credentials record with a new username and password,
         * throws an error on failure
         * @param {GraphQLString} username updates with the new username
         * @param {GraphQLString} password updates with the new note password
         * @param {GraphQLString} secureRecordId points to the note record to be updated
         * @returns {any} newly created credentials data
         */
        updateCredential: {
            type: SecureRecordType,
            args: {
                username: { type: new GraphQLNonNull(GraphQLString) },
                password: { type: new GraphQLNonNull(GraphQLString) },
                secureRecordId: { type: new GraphQLNonNull(GraphQLString) },
            },
            resolve: async (parent, args, context) => {
                const secureRecord = await SecureRecord.findOne({
                    _id: args.secureRecordId,
                });
                if (!secureRecord)
                    throwDBError({ secureRecordId: 'Could not find' }, 404);
                if (secureRecord.uid != context.token.uid)
                    throwDBError({ secureRecordId: 'Unauthorized' }, 403);
                const credential = await WebsiteCredentials.findOne({
                    _id: secureRecord.recordId,
                });
                if (!credential)
                    throwDBError({ secureRecordId: 'Corrupted' }, 410);

                credential.username = args.username;
                credential.password = args.password;
                const updatedCredentials = await credential.save();
                return {
                    ...secureRecord.toObject(),
                    credential: extractRecord(updatedCredentials),
                };
            },
        },
        /**
         * Attempts to delete an existing secure record,
         * throws an error on failure
         * @param {GraphQLString} secureRecordId record to be deleted
         * @returns {any} deleted secure record
         */
        deleteSecureRecord: {
            type: SecureRecordType,
            args: {
                secureRecordId: { type: new GraphQLNonNull(GraphQLString) },
            },
            resolve: async (parent, args, context) => {
                const secureRecord = await SecureRecord.findOne({
                    _id: args.secureRecordId,
                });
                if (!secureRecord)
                    throwDBError({ secureRecordId: 'Could not find' }, 404);
                if (secureRecord.uid != context.token.uid)
                    throwDBError({ secureRecordId: 'Unauthorized' }, 403);
                const database =
                    secureRecord.type == 'account'
                        ? WebsiteCredentials
                        : secureRecord.type == 'seed'
                        ? Seed
                        : Note;
                const data = await database.findOneAndUpdate(
                    { _id: secureRecord.recordId },
                    trusted({
                        $pull: {
                            owners: {
                                secureRecordId: sanitize(args.secureRecordId),
                            },
                        },
                    }),
                    { new: false }
                );
                if (data && data.owners.length == 1) {
                    await database.deleteOne({
                        _id: secureRecord.recordId,
                    });
                }
                await SecureRecord.deleteOne({
                    _id: args.secureRecordId,
                });

                return secureRecord;
            },
        },
        /**
         * Attempts to delete an existing share record,
         * throws an error on failure
         * @param {GraphQLString} secureRecordId id of which shareId belongs to
         * @param {GraphQLString} shareId share to be deleted
         * @returns {any} deleted share record
         */
        deleteShare: {
            type: ShareType,
            args: {
                secureRecordId: { type: new GraphQLNonNull(GraphQLString) },
                shareId: { type: new GraphQLNonNull(GraphQLString) },
            },
            resolve: async (parent, args, context) => {
                const secureRecord = await SecureRecord.findOne({
                    _id: args.secureRecordId,
                });

                if (!secureRecord)
                    throwDBError({ secureRecordId: 'Could not find' }, 404);
                if (secureRecord.uid != context.token.uid)
                    throwDBError({ secureRecordId: 'Unauthorized' }, 403);

                return await Share.findOneAndDelete({
                    _id: args.shareId,
                    recordId: secureRecord.recordId,
                });
            },
        },
        /**
         * Attempts to update the password of the hexagon user,
         * throws an error on failure
         * @param {GraphQLString} oldPassword current password for the user
         * @param {GraphQLString} newPassword password to be updated with
         * @returns {Promise<boolean>} success status
         */
        updatePassword: {
            type: GraphQLBoolean,
            args: {
                oldPassword: { type: new GraphQLNonNull(GraphQLString) },
                newPassword: { type: new GraphQLNonNull(GraphQLString) },
            },
            resolve: async (parent, args, context) => {
                const user = await HexagonUser.findOne({
                    username: context.token.username,
                });
                if (!user) throwDBError({ user: 'Could not find user' }, 404);
                if (!(await bcrypt.compare(args.oldPassword, user.password)))
                    throwDBError({ oldPassword: 'Invalid password' }, 403);

                const [masterKey] = await cryptoService.decryptSecrets(
                    [user.masterKey],
                    args.oldPassword
                );
                const [encryptedMasterKey, encryptedUid] =
                    await cryptoService.encryptSecrets(
                        [masterKey, context.token.uid],
                        args.newPassword
                    );

                user.password = args.newPassword;
                user.masterKey = encryptedMasterKey;
                user.uid = encryptedUid;
                await user.save();
                return true;
            },
        },
        /**
         * Attempts to revoke a share from the given secureRecordId,
         * throws an error on failure
         * @param {GraphQLString} owner username of the owner to be revoked
         * @param {GraphQLString} secureRecordId Id of the record to perform the revoke action
         * @returns {any} boolean value
         */
        revokeShare: {
            type: GraphQLBoolean,
            args: {
                secureRecordId: { type: new GraphQLNonNull(GraphQLString) },
                owner: { type: new GraphQLNonNull(GraphQLString) },
            },
            resolve: async (parent, args, context) => {
                const secureRecord = await SecureRecord.findOne({
                    _id: args.secureRecordId,
                });

                if (!secureRecord)
                    throwDBError({ secureRecordId: 'Could not find' }, 404);
                if (secureRecord.uid != context.token.uid)
                    throwDBError({ secureRecordId: 'Unauthorized' }, 403);

                const database =
                    secureRecord.type == 'account'
                        ? WebsiteCredentials
                        : secureRecord.type == 'seed'
                        ? Seed
                        : Note;

                const record = await database.findOneAndUpdate(
                    { _id: secureRecord.recordId },
                    trusted({
                        $pull: {
                            owners: {
                                username: sanitize(args.owner),
                            },
                        },
                    }),
                    { new: false }
                );
                if (!record) throwDBError({ secureRecordId: 'Corrupted' }, 410);

                const idx = record.owners.findIndex(
                    (owner) => owner.username === args.owner
                );
                if (idx === -1) throwDBError({ owner: 'Does not exist' }, 404);

                const { deletedCount } = await SecureRecord.deleteOne({
                    _id: record.owners[idx].secureRecordId,
                });

                if (record.owners.length === 1) {
                    await database.deleteOne({
                        _id: secureRecord.recordId,
                    });
                }
                return deletedCount === 1;
            },
        },
        /**
         * Finalizes a share based on given arguments,
         * If isAccepted is true, user becomes a new owner of the recordID,
         * throws an error on any failures
         * @param {GraphQLString} shareKey key used for decryption
         * @param {GraphQLString} shareId Id pointing to share record request
         * @param {GraphQLBoolean} isAccepted determines if user accepts or declines share request
         * @param {GraphQLString} masterUsername username of the current user
         * @param {GraphQLString} recordKey key used to create to secure record
         * @returns {any} secure record id
         */
        finalizeShare: {
            type: GraphQLString,
            args: {
                shareKey: { type: new GraphQLNonNull(GraphQLString) },
                shareId: { type: new GraphQLNonNull(GraphQLString) },
                isAccepted: { type: new GraphQLNonNull(GraphQLBoolean) },
                masterUsername: { type: new GraphQLNonNull(GraphQLString) },
                recordKey: { type: new GraphQLNonNull(GraphQLString) },
            },
            resolve: async (parent, args, context) => {
                const share = await Share.findOne({ _id: args.shareId });

                if (!share) throwDBError({ shareId: 'Could not find' }, 404);
                const [key] = await cryptoService.decryptSecrets(
                    [share.key],
                    args.shareKey
                );
                const [receiver] = await cryptoService.decryptData(
                    [share.receiver],
                    key
                );
                if (receiver != context.token.username)
                    throwDBError({ receiver: 'Unauthorized' }, 403);

                await Share.deleteOne({
                    _id: args.shareId,
                });

                if (!args.isAccepted) return share._id;

                const secureRecord = await new SecureRecord({
                    name: share.name,
                    key: args.recordKey,
                    recordId: share.recordId,
                    uid: context.token.uid,
                    type: share.type,
                }).save();

                const database =
                    secureRecord.type == 'account'
                        ? WebsiteCredentials
                        : secureRecord.type == 'seed'
                        ? Seed
                        : Note;

                await database.updateOne(
                    { _id: share.recordId },
                    {
                        $push: {
                            owners: {
                                username: args.masterUsername,
                                secureRecordId: secureRecord._id,
                            },
                        },
                    }
                );
                return secureRecord._id;
            },
        },
    },
});

module.exports = Object.freeze({
    Mutation,
});
