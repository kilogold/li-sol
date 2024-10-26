import { NextApiRequest, NextApiResponse } from 'next';
import { createUiAmountToAmountInstruction, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { simulateTransaction } from '../utility';
import { Transaction } from '@solana/web3.js';

export async function POST(req: NextApiRequest, res: NextApiResponse) {
  console.log('uiAmountToAmount handler called');

  if (req.method !== 'POST') {
    console.log('Invalid method:', req.method);
    return res.status(405).send('Method not allowed');
  }

  return await simulateTransaction(req, res, (mintPublicKey, amount) =>
    new Transaction().add(
      createUiAmountToAmountInstruction(mintPublicKey, amount, TOKEN_2022_PROGRAM_ID)
    )
  );
}
