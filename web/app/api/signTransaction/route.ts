import { NextApiRequest, NextApiResponse } from 'next';
import { Keypair, PublicKey, Transaction, Connection } from '@solana/web3.js';
import {
  createAmountToUiAmountInstruction,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';

export async function POST(req: NextApiRequest, res: NextApiResponse) {
  console.log('signTransaction handler called'); // Initial log

  if (req.method !== 'POST') {
    console.log('Invalid method:', req.method); // Log invalid method
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    console.log('Request body:', req.body); // Log request body
    // Manually parse the ReadableStream to JSON
    const buffers = [];
    for await (const chunk of req.body) {
      buffers.push(chunk);
    }
    const bodyString = Buffer.concat(buffers).toString();
    const body = JSON.parse(bodyString);

    console.log('Parsed body:', body); // Log parsed body

    const { mint, amount, endpoint } = body as {
      mint: string;
      amount: string;
      endpoint: string;
    };

    if (!mint || !amount || !endpoint) {
      const errorMessage = `Missing required fields: ${JSON.stringify({
        mint,
        amount,
        endpoint,
      })}`;
      console.error(errorMessage);
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

    console.log('Creating connection to endpoint:', endpoint);
    const connection = new Connection(endpoint);

    console.log('Creating mint public key:', mint);
    const mintPublicKey = new PublicKey(mint);

    console.log('Creating transaction');
    const transaction = new Transaction().add(
      createAmountToUiAmountInstruction(
        mintPublicKey,
        BigInt(amount),
        TOKEN_2022_PROGRAM_ID
      )
    );
    transaction.recentBlockhash = (
      await connection.getLatestBlockhash()
    ).blockhash;
    transaction.feePayer = keypair.publicKey;
    transaction.sign(keypair);

    console.log('Transaction created:\n', transaction);
    return new Response(transaction.serialize().toString('base64'), { status: 200 });
  } catch (error) {
    const errorMessage = `Error in signTransaction: ${
      (error as Error).message || 'Failed to sign the transaction'
    }`;
    console.error(errorMessage);
    return new Response((error as Error).message || 'Failed to sign the transaction', { status: 500 });
  }
}
