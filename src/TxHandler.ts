import { Logger } from '@/utils/Logger';
import type { SignerOptions } from '@polkadot/api/submittable/types';
import type { SubmittableExtrinsic } from '@polkadot/api/types';
import type { KeyringPair } from '@polkadot/keyring/types';
import type { ISubmittableResult } from '@polkadot/types/types';
import colors from 'colors';


const logger : Logger = new Logger('TxHandler', true);

export class TxHandler
{
    
    public static async handle (
        transaction : SubmittableExtrinsic<any>,
        keyringPair : KeyringPair,
        transactionId : string,
        options? : Partial<SignerOptions>
    ) : Promise<ISubmittableResult>
    {
        return new Promise<any>(async(resolve, reject) => {
            const unsub : any = await transaction
                .signAndSend(keyringPair, options, (result, extra) => {
                    if (result.status.isReady) {
                        logger.debug(transactionId + ': ' + colors.grey('ready'));
                    }
                    else if (result.status.isBroadcast) {
                        logger.debug(transactionId + ': ' + colors.grey('brodcast'));
                    }
                    else if (result.status.isInvalid) {
                        logger.debug(transactionId + ': ' + colors.red('invalid'));
                        reject(result);
                    }
                    else if (result.status.isDropped) {
                        logger.debug(transactionId + ': ' + colors.red('dropped'));
                        reject(result);
                    }
                    else if (result.status.isRetracted) {
                        logger.debug(transactionId + ': ' + colors.red('retracted'));
                        reject(result);
                    }
                    else if (result.status.isInBlock) {
                        logger.debug(transactionId + ': ' + colors.green('in block'));
                        resolve(result);
                    }
                    else if (result.status.isUsurped) {
                        logger.debug(transactionId + ': ' + colors.green('is usurped'));
                        reject(result);
                    }
                    
                    if (result.status.isFinalized || result.status.isFinalityTimeout) {
                        resolve(result);
                        unsub();
                    }
                });
        });
    }
    
}
