import type { AccountKey } from '@/def';
import { ContractType } from '@/def';
import { DevPhase } from '@/service/api/DevPhase';
import { EventQueue } from '@/service/api/EventQueue';
import { TxHandler } from '@/service/api/TxHandler';
import type { Contract, ContractMetadata } from '@/typings';
import { Exception } from '@/utils/Exception';
import { waitFor, WaitForOptions } from '@/utils/waitFor';
import * as PhalaSdk from '@phala/sdk';
import { ApiPromise } from '@polkadot/api';
import { Abi, ContractPromise } from '@polkadot/api-contract';
import { KeyringPair } from '@polkadot/keyring/types';
import type { ContractInstantiateResult } from '@polkadot/types/interfaces/contracts';


export type CreateOptions = {
    contractType? : ContractType,
    clusterId? : string,
    systemContract? : boolean,
}

export type DeployOptions = {
    forceUpload? : boolean,
    asAccount? : AccountKey | KeyringPair,
}

export type InstantiateOptions = {
    salt? : string | number,
    asAccount? : AccountKey | KeyringPair,
    transfer? : number,
    gasLimit? : number,
    storageDepositLimit? : number,
    deposit? : number,
    transferToCluster? : number,
    adjustStake? : number,
}


export class ContractFactory
{

    public static readonly CODE_TYPE_MAP = {
        [ContractType.InkCode]: 'Ink',
        [ContractType.SidevmCode]: 'Sidevm',
    }
    
    public readonly contractType : string;
    public readonly metadata : ContractMetadata.Metadata;
    public readonly clusterId : string;
    
    protected _devPhase : DevPhase;
    protected _blockTime : number;
    protected _systemContract : Contract;
    protected _eventQueue : EventQueue = new EventQueue();
    
    
    
    public get api () : ApiPromise
    {
        return this._devPhase.api;
    }
    
    protected async init (
        loadSystemContract : boolean = false
    )
    {
        await this._eventQueue.init(this._devPhase.api);
        
        if (loadSystemContract) {
            this._systemContract = await this._devPhase.getSystemContract(this.clusterId);
        }
    }
    
    
    public static async create<T extends ContractFactory> (
        devPhase : DevPhase,
        metadata : ContractMetadata.Metadata,
        options : CreateOptions = {}
    ) : Promise<T>
    {
        options = {
            systemContract: false,
            ...options,
        }
    
        const instance = new ContractFactory();
        
        instance._devPhase = devPhase;
        instance._blockTime = devPhase.blockTime;
        
        if (!options.clusterId) {
            options.clusterId = devPhase.mainClusterId;
        }
        
        Object.assign(instance, {
            metadata,
            contractType: options.contractType,
            clusterId: options.clusterId,
        });
        
        await instance.init(!options.systemContract);
        
        return <any>instance;
    }
    
    
    /**
     * Deploying contract to network
     */
    public async deploy (
        options : DeployOptions = {}
    ) : Promise<void>
    {
        options = {
            forceUpload: false,
            asAccount: 'alice',
            ...options
        };
        
        const keyringPair : any = typeof options.asAccount === 'string'
            ? this._devPhase.accounts[options.asAccount]
            : options.asAccount;
            
        // verify is it required to upload resource
        if (!options.forceUpload) {
            if (!this._systemContract) {
                throw new Exception(
                    'System contract is not ready',
                    1679713544635
                );
            }
        
            const cert = await PhalaSdk.signCertificate({
                api: this.api,
                pair: keyringPair
            });
            
            const codeType = ContractFactory.CODE_TYPE_MAP[this.contractType];
            if (!codeType) {
                throw new Exception(
                    `Unable to map contract type <${this.contractType}> to code type`,
                    1679713421053
                );
            }
            
            const { output } = await this._systemContract.query['system::codeExists'](
                cert,
                {},
                this.metadata.source.hash,
                codeType
            );
            
            const codeExists = output.toJSON();
            if (codeExists?.ok) {
                // already uploaded
                return;
            }
        }
        
        await TxHandler.handle(
            this.api.tx.phalaPhatContracts.clusterUploadResource(
                this.clusterId,
                this.contractType,
                this.metadata.source.wasm
            ),
            keyringPair,
            true
        );
    }
    
    
    /**
     * Creating contract instance
     */
    public async instantiate<T extends Contract> (
        constructor : string,
        params : any[] = [],
        options : InstantiateOptions = {}
    ) : Promise<T>
    {
        options = {
            salt: 1000000000 + Math.round(Math.random() * 8999999999),
            asAccount: 'alice',
            transfer: 0,
            gasLimit: 1e12,
            storageDepositLimit: null,
            deposit: 0,
            transferToCluster: 1e12,
            adjustStake: 1e12,
            ...options
        };
        
        const abi = new Abi(this.metadata);
        const callData = abi.findConstructor(constructor).toU8a(params);
        const salt = typeof options.salt == 'number'
            ? '0x' + options.salt.toString(16)
            : options.salt
        ;
        
        const keyringPair : any = typeof options.asAccount === 'string'
            ? this._devPhase.accounts[options.asAccount]
            : options.asAccount;
        
        const result = await TxHandler.handle(
            this.api.tx.phalaPhatContracts.instantiateContract(
                { WasmCode: this.metadata.source.hash },
                callData,
                salt,
                this.clusterId,
                options.transfer,
                options.gasLimit,
                options.storageDepositLimit,
                options.deposit
            ),
            keyringPair,
            true
        );
        
        const instantiateEvent = result.events.find(({ event }) => {
            return event.section === 'phalaPhatContracts'
                && event.method === 'Instantiating';
        });
        if (!instantiateEvent) {
            throw new Exception(
                'Error while instantiating contract',
                1675502920365
            );
        }
        
        const contractId = instantiateEvent.event.data[0].toString();
        
        // wait for instantation
        try {
            await this._waitFor(
                async() => {
                    const key = await this.api.query
                        .phalaRegistry.contractKeys(contractId);
                    return !key.isEmpty;
                },
                (50 * this._blockTime)
            );
        }
        catch (e) {
            throw new Exception(
                'Could not get contract public key',
                1663952347291,
                e
            );
        }
        
        // transfer funds to cluster if specified
        if (options.transferToCluster) {
            const result = await TxHandler.handle(
                this.api.tx.phalaPhatContracts.transferToCluster(
                    options.transferToCluster,
                    this.clusterId,
                    contractId
                ),
                keyringPair,
                true
            );
        }
        
        // adjust stake if specified
        if (options.adjustStake) {
            const result = await TxHandler.handle(
                this.api.tx.phalaPhatTokenomic.adjustStake(
                    contractId,
                    options.adjustStake
                ),
                keyringPair,
                true
            );
        }
        
        return this.attach(contractId);
    }
    
    
    public async estimateInstatiationFee (
        constructor : string,
        params : any[] = [],
        options : InstantiateOptions
    ) : Promise<ContractInstantiateResult>
    {
        const systemContract = await this._devPhase.getSystemContract(this.clusterId);
        
        const abi = new Abi(this.metadata);
        const callData = abi.findConstructor(constructor).toU8a(params);
        const salt = typeof options.salt == 'number'
            ? '0x' + options.salt.toString(16)
            : options.salt
        ;
        
        const keyringPair : any = typeof options.asAccount === 'string'
            ? this._devPhase.accounts[options.asAccount]
            : options.asAccount;
        
        const cert = await PhalaSdk.signCertificate({
            api: this.api,
            pair: keyringPair
        });
        
        const instantiateReturn = await systemContract.instantiate({
            codeHash: this.metadata.source.hash,
            salt,
            instantiateData: callData,
            deposit: options.deposit,
            transfer: options.transfer
        }, cert);
        
        return <any> instantiateReturn;
    }
    
    
    public async attach<T extends Contract> (
        contractId : string
    ) : Promise<T>
    {
        const api : any = await this._devPhase.createApiPromise();
        
        const phala : any = await PhalaSdk.create({
            api: api,
            baseURL: this._devPhase.workerUrl,
            contractId,
            autoDeposit: true,
        });
        
        const instance = new ContractPromise(
            phala.api,
            this.metadata,
            contractId,
        );
        
        Object.assign(instance, {
            contractId,
            clusterId: this.clusterId,
            sidevmQuery: phala.sidevmQuery,
            instantiate: phala.instantiate,
        });
        
        return <any>instance;
    }
    
    
    protected async _waitFor (
        callback : () => Promise<any>,
        timeLimit : number,
        options : WaitForOptions = {}
    )
    {
        const firstTry = await callback();
        if (firstTry) {
            return firstTry;
        }
        
        const result = waitFor(
            callback,
            timeLimit,
            options
        );
        
        return result;
    }
    
}
