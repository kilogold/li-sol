import { NextApiRequest, NextApiResponse } from 'next';
import { PublicKey, Transaction, Connection, Keypair, TransactionError } from '@solana/web3.js';

export type OperationCallback = (connection: Connection, signer: Keypair, mintPublicKey: PublicKey, amount: string) => Promise<string>;

export async function simulateTransaction(
  req: NextApiRequest,
  res: NextApiResponse,
  instructionCreator: OperationCallback
): Promise<Response> {
  try {
    const buffers = [];
    for await (const chunk of req.body) {
      buffers.push(chunk);
    }
    const bodyString = Buffer.concat(buffers).toString();
    const body = JSON.parse(bodyString);

    const { mint, amount, endpoint } = body as {
      mint: string;
      amount: string;
      endpoint: string;
    };

    if (!mint || !amount || !endpoint) {
      return new Response('Missing required fields', { status: 400 });
    }

    const privateKeyString = process.env.SOLANA_PRIVATE_KEY;

    if (!privateKeyString) {
      const errorMessage = 'SOLANA_PRIVATE_KEY environment variable is not set';
      console.error(errorMessage);
      return new Response('Internal server error', { status: 500 });
    }

    let privateKey: Uint8Array;
    try {
      privateKey = new Uint8Array(JSON.parse(privateKeyString));
    } catch (e) {
      const errorMessage = `Invalid SOLANA_PRIVATE_KEY format: ${privateKeyString}`;
      console.error(errorMessage);
      return new Response('Internal server error', { status: 500 });
    }

    const keypair = Keypair.fromSecretKey(privateKey);

    const connection = new Connection(endpoint);
    const mintPublicKey = new PublicKey(mint);

    const result = await instructionCreator(connection, keypair, mintPublicKey, amount);
    
    return new Response(result, { status: 200 });
  
} catch (error) {
    console.error('Error in utility function2:', error);
    return new Response(`Internal server error: ${error}`, { status: 500 });
  }
}
