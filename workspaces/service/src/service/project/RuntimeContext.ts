import {
    ProjectConfig,
    ProjectConfigOptions,
    RunMode,
    RuntimePaths,
    StackSetupMode,
    TestingConfig,
    VerbosityLevel
} from '@/def';
import { DevPhase } from '@/service/api/DevPhase';
import { StackBinaryDownloader } from '@/service/project/StackBinaryDownloader';
import { Exception } from '@/utils/Exception';
import { replacePlaceholders } from '@/utils/replacePlaceholders';
import { replaceRecursive } from '@/utils/replaceRecursive';
import { types as PhalaSDKTypes } from '@phala/sdk';
import { khalaDev as KhalaTypes } from '@phala/typedefs';
import findUp from 'find-up';
import fs from 'fs';
import Listr from 'listr';
import path from 'path';


export class RuntimeContext
{
    
    protected static readonly SINGLETON_KEY = 'devphase_Context_VSffVql3bvj9aulZY5DNnRCnrEt1V27a';
    
    public static readonly CONFIG_FILES : string[] = [
        'devphase.config.ts',
        'devphase.config.js',
        'devphase.config.json',
    ];
    
    public static readonly NETWORK_LOCAL = 'local';
    
    protected _stackBinaryDownloader : StackBinaryDownloader;
    protected _devPhases : Record<string, DevPhase> = {};
    
    public readonly verbosity : VerbosityLevel = VerbosityLevel.Default;
    public readonly listrRenderer : Listr.ListrRendererValue<any> = 'default';
    
    public readonly config : ProjectConfig;
    public readonly paths : RuntimePaths = {
        devphase: null,
        templates: null,
        project: null,
        context: null,
        
        artifacts: null,
        contracts: null,
        logs: null,
        currentLog: null,
        scripts: null,
        stacks: null,
        currentStack: null,
        tests: null,
        typings: null,
    };
    
    public testingConfig : TestingConfig;
    
    
    public static async getSingleton () : Promise<RuntimeContext>
    {
        const globalAny = global as any;
        
        const singletonKey = RuntimeContext.SINGLETON_KEY;
        if (!globalAny[singletonKey]) {
            const instance = new RuntimeContext();
            globalAny[singletonKey] = instance;
        }
        
        return globalAny[singletonKey];
    }
    
    
    private constructor ()
    {
        this._stackBinaryDownloader = new StackBinaryDownloader(this);
    }
    
    
    public async isInProjectDirectory () : Promise<boolean>
    {
        const configFilePath = await findUp(RuntimeContext.CONFIG_FILES);
        
        return (configFilePath !== undefined);
    }
    
    public async requestProjectDirectory ()
    {
        const isInProjectDirectory = await this.isInProjectDirectory();
        if (!isInProjectDirectory) {
            throw new Exception(
                'Config file not found',
                1665952724703
            );
        }
    }
    
    
    public async initContext (runMode : RunMode) : Promise<void>
    {
        const configFilePath = await findUp(RuntimeContext.CONFIG_FILES);
        
        const packageFilePath = await findUp(
            [ 'package.json' ],
            { cwd: __dirname }
        );
        this.paths.devphase = path.dirname(packageFilePath);
        
        this.paths.templates = path.join(
            this.paths.devphase,
            'templates'
        );
        
        let userConfig : ProjectConfigOptions = {};
        if (configFilePath) {
            this.paths.project = path.dirname(configFilePath);
            userConfig = configFilePath.endsWith('.json')
                ? require(configFilePath)
                : require(configFilePath).default
            ;
        }
        else {
            this.paths.project = process.cwd();
        }
        
        // create context directory
        this.paths.context = path.join(
            this.paths.project,
            '.devphase'
        );
        
        if (!fs.existsSync(this.paths.context)) {
            fs.mkdirSync(this.paths.context, { recursive: true });
        }
        
        // get configuration
        const config = await this._getRunConfiguration(
            userConfig,
            runMode
        );
        Object.assign(this, { config });
        
        // setup directories
        for (const [ name, directory ] of Object.entries(this.config.directories)) {
            this.paths[name] = path.resolve(
                this.paths.project,
                directory
            );
        }
        
        const logStamp = (new Date()).toISOString();
        this.paths.currentLog = path.join(
            this.paths.logs,
            logStamp
        );
        
        this.paths.currentStack = path.join(
            this.paths.stacks,
            this.config.stack.version
        );
        
        // testing config
        this.testingConfig = {
            spawnStack: true,
            network: RuntimeContext.NETWORK_LOCAL,
            blockTime: this.config.testing.blockTime,
            stackSetupMode: StackSetupMode.Minimal,
        };
    }
    
    public async initDevPhase (
        network : string = RuntimeContext.NETWORK_LOCAL
    ) : Promise<DevPhase>
    {
        if (this._devPhases[network]) {
            throw new Exception(
                'DevPhase was already initiated',
                1673451278525
            );
        }
        
        this._devPhases[network] = await DevPhase.create(this, { network });
        
        return this._devPhases[network];
    }
    
    public getDevPhase (
        network : string = RuntimeContext.NETWORK_LOCAL
    ) : DevPhase
    {
        if (!this._devPhases[network]) {
            throw new Exception(
                'DevPhase is not ready yet',
                1673451408519
            );
        }
        
        return this._devPhases[network];
    }
    
    
    public setVerbosityLevel (level : VerbosityLevel)
    {
        const listrRenderer : Listr.ListrRendererValue<any> = level == VerbosityLevel.Verbose
            ? 'verbose'
            : level == VerbosityLevel.Silent
                ? 'silent'
                : 'default'
        ;
        
        Object.assign(this, {
            verbosity: level,
            listrRenderer,
        });
    }
    
    public async requestStackBinaries (
        execute : boolean = true
    ) : Promise<Listr>
    {
        return this._stackBinaryDownloader.downloadIfRequired(execute);
    }
    
    protected async _getRunConfiguration (
        options : ProjectConfigOptions,
        runMode : RunMode
    ) : Promise<ProjectConfig>
    {
        const config : ProjectConfig = <any>replaceRecursive<ProjectConfigOptions>({
            general: {
                ss58Format: 30,
            },
            directories: {
                artifacts: 'artifacts',
                contracts: 'contracts',
                logs: 'logs',
                scripts: 'scripts',
                stacks: 'stacks',
                tests: 'tests',
                typings: 'typings'
            },
            stack: {
                version: 'latest',
                blockTime: 6000, // default block time for running local stack
                setupOptions: {
                    mode: StackSetupMode.None,
                    workerUrl: 'http://localhost:{{stack.pruntime.port}}'
                },
                node: {
                    port: 9944,
                    binary: '{{directories.stacks}}/{{stack.version}}/phala-node',
                    workingDir: '{{directories.stacks}}/.data/node',
                    dataDir: '{{directories.stacks}}/.data/node',
                    envs: {},
                    args: {
                        '--dev': true,
                        '--rpc-methods': 'Unsafe',
                        '--ws-port': '{{stack.node.port}}',
                        '--base-path': '.',
                        '--block-millisecs': '{{stack.blockTime}}', // override at runtime
                    },
                    timeout: 20000,
                },
                pruntime: {
                    port: 8000,
                    binary: '{{directories.stacks}}/{{stack.version}}/pruntime',
                    workingDir: '{{directories.stacks}}/.data/pruntime',
                    dataDir: '{{directories.stacks}}/.data/pruntime',
                    envs: {},
                    args: {
                        '--allow-cors': true,
                        '--cores': 0,
                        '--port': '{{stack.pruntime.port}}'
                    },
                    timeout: 10000,
                },
                pherry: {
                    gkMnemonic: '//Alice',
                    binary: '{{directories.stacks}}/{{stack.version}}/pherry',
                    workingDir: '{{directories.stacks}}/.data/pherry',
                    dataDir: '{{directories.stacks}}/.data/pherry',
                    envs: {},
                    args: {
                        '--no-wait': true,
                        '--mnemonic': '{{stack.pherry.gkMnemonic}}',
                        '--inject-key': '0000000000000000000000000000000000000000000000000000000000000001',
                        '--substrate-ws-endpoint': 'ws://localhost:{{stack.node.port}}',
                        '--pruntime-endpoint': 'http://localhost:{{stack.pruntime.port}}',
                        '--attestation-provider': 'none',
                        '--dev-wait-block-ms': '{{stack.blockTime}}', // override at runtime
                    },
                    timeout: 10000,
                }
            },
            testing: {
                mocha: {}, // custom mocha configuration
                blockTime: 100, // block time override for spawning local testnet
                stackSetupConfig: {
                    setup: {
                        custom: undefined,
                        timeout: 2 * 60 * 1000,
                    },
                    teardown: {
                        custom: undefined,
                        timeout: 10 * 1000,
                    }
                },
                stackLogOutput: false, // display stack output in console
            },
            networks: {
                [RuntimeContext.NETWORK_LOCAL]: {
                    nodeUrl: 'ws://localhost:{{stack.node.port}}',
                    nodeApiOptions: {
                        types: {
                            ...KhalaTypes,
                            ...PhalaSDKTypes,
                        },
                        signedExtensions: {
                            CheckMqSequence: {} // fix debug output
                        }
                    },
                    workerUrl: 'http://localhost:{{stack.pruntime.port}}',
                }
            },
            accountsConfig: {
                keyrings: {
                    alice: '//Alice',
                    bob: '//Bob',
                    charlie: '//Charlie',
                    dave: '//Dave',
                    eve: '//Eve',
                    ferdie: '//Ferdie'
                },
                suAccount: 'alice'
            }
        }, options);
        
        // replace stack version
        config.stack.version = await this._stackBinaryDownloader.uniformStackVersion(config.stack.version);
        
        // process placeholders
        replacePlaceholders(config, config);
        
        return config;
    }
    
}
