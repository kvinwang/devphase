const { DevPhase, Logger, RunMode, RuntimeContext, StackManager } = require('@devphase/service');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);
global.expect = chai.expect;

const logger = new Logger('Test');

before(async function() {
    this.runtimeContext = await RuntimeContext.getSingleton();
    this.stackManager = new StackManager(this.runtimeContext);
    
    const testingConfig = this.runtimeContext.testingConfig;
    const { stackSetupConfig: { setup } } = this.runtimeContext.config.testing;
    
    this.timeout(setup.timeout);
    
    logger.log('Global setup start');
    
    if (testingConfig.spawnStack) {
        logger.log('Preparing dev stack');
        await this.stackManager.startStack(
            RunMode.Testing,
            {
                saveLogs: true,
                blockTime: testingConfig.blockTime,
            }
        );
    }
    
    logger.log('Init API');
    this.devPhase = await DevPhase.create(this.runtimeContext, {
        network: testingConfig.network,
        blockTime: testingConfig.blockTime,
    });
    this.api = this.devPhase.api;
    
    logger.log('Setup environment');
    if (setup.custom) {
        await setup.custom(this.devPhase);
    }
    else {
        // run default
        await this.devPhase.stackSetup({ mode: testingConfig.stackSetupMode });
    }
    
    logger.log('Global setup done');
    logger.log('Starting tests');
});

after(async function() {
    logger.log('Global teardown start');
    
    const testingConfig = this.runtimeContext.testingConfig;
    const { stackSetupConfig: { teardown } } = this.runtimeContext.config.testing;
    
    this.timeout(teardown.timeout);
    
    if (teardown.custom) {
        logger.log('Custom tear down');
        await teardown.custom(this.devPhase);
    }
    
    if (this.devPhase) {
        logger.log('Internal clean up');
        await this.devPhase.cleanup();
    }
    
    if (
        testingConfig.spawnStack
        && this.stackManager
    ) {
        logger.log('Stopping stack');
        await this.stackManager.stopStack();
    }
    
    logger.log('Global teardown done');
});
