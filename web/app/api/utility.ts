import { NextApiRequest, NextApiResponse } from 'next';
import { PublicKey, Transaction, Connection, Keypair } from '@solana/web3.js';

export async function simulateTransaction(
  req: NextApiRequest,
  res: NextApiResponse,
  instructionCreator: (mintPublicKey: PublicKey, amount: string) => Transaction
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
      console.error('Missing required fields');
      return new Response('Missing required fields', { status: 400 });
    }

    const privateKeyString = process.env.SOLANA_PRIVATE_KEY;
    console.log('SOLANA_PRIVATE_KEY:', privateKeyString); // Log environment variable

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

    console.log('Creating keypair from private key:', privateKey);
    const keypair = Keypair.fromSecretKey(privateKey);

    const connection = new Connection(endpoint);
    const mintPublicKey = new PublicKey(mint);

    const transaction = instructionCreator(mintPublicKey, amount);

    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    transaction.feePayer = keypair.publicKey;
    transaction.sign(keypair);

    const { returnData, err } = (await connection.simulateTransaction(transaction)).value;

    if (err) {
      throw new Error(err.toString());
    }

    if (returnData?.data) {
      const resultValue = Buffer.from(returnData.data[0], returnData.data[1]).toString('utf-8');
      return new Response(resultValue, { status: 200 });
    } else {
      return new Response('Failed to fetch result value', { status: 500 });
    }
  } catch (error) {
    console.error('Error in simulateTransaction:', error);
    return new Response('Failed to process the transaction', { status: 500 });
  }
}
