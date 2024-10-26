import { NextApiRequest, NextApiResponse } from 'next';
import { createAmountToUiAmountInstruction, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { simulateTransaction } from '../utility';
import { Transaction } from '@solana/web3.js';

export async function POST(req: NextApiRequest, res: NextApiResponse) {
  console.log('amountToUiAmount handler called');
  console.log('Type of res:', typeof res); // Debugging line
  console.log('Is res a function:', typeof res.status === 'function');
  if (req.method !== 'POST') {
    console.log('Invalid method:', req.method);
    return res.status(405).send('Method not allowed');
  }

  return await simulateTransaction(req, res, (mintPublicKey, amount) =>
    new Transaction().add(
      createAmountToUiAmountInstruction(mintPublicKey, BigInt(amount), TOKEN_2022_PROGRAM_ID)
    )
  );
}
