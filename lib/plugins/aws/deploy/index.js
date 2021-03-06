'use strict';

/*
 * serverless package => package in default .serverless dir
 * serverless package --package => package in custom path
 *
 * serverless deploy => package in default .serverless & deploy from default .serverless
 * serverless deploy --package => deploy from custom path
 */

const BbPromise = require('bluebird');
const extendedValidate = require('./lib/extendedValidate');
const monitorStack = require('../lib/monitorStack');
const createStack = require('./lib/createStack');
const setBucketName = require('../lib/setBucketName');
const cleanupS3Bucket = require('./lib/cleanupS3Bucket');
const uploadArtifacts = require('./lib/uploadArtifacts');
const updateStack = require('../lib/updateStack');
const path = require('path');

class AwsDeploy {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.provider = this.serverless.getProvider('aws');
    this.servicePath = this.serverless.config.servicePath || '';
    this.packagePath = this.options.package ||
      this.serverless.service.package.path ||
      path.join(this.servicePath, '.serverless');

    Object.assign(
      this,
      extendedValidate,
      createStack,
      setBucketName,
      cleanupS3Bucket,
      uploadArtifacts,
      updateStack,
      monitorStack
    );

    // Define the internal lifecycle model
    this.commands = {
      aws: {
        type: 'entrypoint',
        commands: {
          deploy: {
            commands: {
              deploy: {
                lifecycleEvents: [
                  'createStack',
                  'uploadArtifacts',
                  'updateStack',
                ],
              },
              finalize: {
                lifecycleEvents: [
                  'cleanup',
                ],
              },
            },
          },
        },
      },
    };

    this.hooks = {
      'before:deploy:deploy': () => BbPromise.bind(this)
        .then(() => this.serverless.pluginManager.spawn('aws:common:validate'))
        .then(() => {
          if (!this.options.package && !this.serverless.service.package.path) {
            return this.extendedValidate();
          }
          return BbPromise.bind(this)
            .then(() => this.serverless.pluginManager.spawn('aws:common:moveArtifactsToTemp'))
            .then(this.extendedValidate);
        }),

      // Deploy outer lifecycle
      'deploy:deploy': () => BbPromise.bind(this)
        .then(() => {
          if (this.options.noDeploy) {
            return BbPromise.resolve();
          }
          return this.serverless.pluginManager.spawn('aws:deploy:deploy');
        }),

      'deploy:finalize': () => this.serverless.pluginManager.spawn('aws:deploy:finalize'),

      // Deploy deploy inner lifecycle
      'aws:deploy:deploy:createStack': () => BbPromise.bind(this)
        .then(this.createStack),

      'aws:deploy:deploy:uploadArtifacts': () => BbPromise.bind(this)
        .then(this.setBucketName)
        .then(this.uploadArtifacts),

      'aws:deploy:deploy:updateStack': () => BbPromise.bind(this)
        .then(this.updateStack),

      // Deploy finalize inner lifecycle
      'aws:deploy:finalize:cleanup': () => BbPromise.bind(this)
        .then(() => {
          if (this.options.noDeploy) {
            return BbPromise.resolve();
          }
          return this.cleanupS3Bucket();
        })
        .then(() => {
          if (this.options.package || this.serverless.service.package.path) {
            return BbPromise.bind(this)
              .then(() => this.serverless.pluginManager.spawn('aws:common:cleanupTempDir'));
          }
          return BbPromise.resolve();
        }),
    };
  }
}

module.exports = AwsDeploy;
