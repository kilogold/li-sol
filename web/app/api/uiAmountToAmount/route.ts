import { NextApiRequest, NextApiResponse } from 'next';
import { TOKEN_2022_PROGRAM_ID, uiAmountToAmount } from '@solana/spl-token';
import { simulateTransaction } from '../utility';

export async function POST(req: NextApiRequest, res: NextApiResponse) {
  //console.log('uiAmountToAmount handler called');

  if (req.method !== 'POST') {
    console.log('Invalid method:', req.method);
    return res.status(405).send('Method not allowed');
  }

  return await simulateTransaction(req, res, async (connection, signer, mintPublicKey, amount) => {
    //console.log('amount:', amount);
    const result = await uiAmountToAmount(connection,signer, mintPublicKey, amount, TOKEN_2022_PROGRAM_ID);

    if (result === null) {
      throw new Error('Invalid amount');
    }
    return result.toString();
  });
}
