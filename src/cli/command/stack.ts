import { SpawnMode } from '@/def';
import { RuntimeContext } from '@/service/RuntimeContext';
import { StackManager } from '@/service/StackManager';
import { Logger } from '@/utils/Logger';
import { Command } from 'commander';


async function command (context : RuntimeContext)
{
    const logger = new Logger('Stack');
    
    logger.log('Starting');
    
    const stackManager = new StackManager(context);
    
    try {
        const processes = await stackManager.startStack(SpawnMode.Foreground);
    }
    catch (e) {
        await stackManager.stopStack();
        
        throw e;
    }
    
    process.on('SIGINT', async() => {
        logger.log('Got SIGINT - shutting down');
        
        await stackManager.stopStack();
    });
}

export function stackCommand (
    program : Command,
    context : RuntimeContext
)
{
    program.command('stack')
        .description('Start Phala stack')
        .action(async() => command(context));
}
