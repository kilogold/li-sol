'use client';

import { PublicKey } from '@solana/web3.js';
import { useMemo, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useConnection } from '@solana/wallet-adapter-react';

import { ExplorerLink } from '../cluster/cluster-ui';
import { AppHero, ellipsify } from '../ui/ui-layout';
import {
  AccountBalance,
  AccountButtons,
  AccountTokens,
  AccountTransactions,
  FilteredAccountTransactions,
} from './account-ui';
import { isInterestBearingAccount } from './account-data-access'; // Ensure this import is correct

export default function AccountDetailFeature() {
  const { connection } = useConnection();
  const params = useParams();
  const [isInterestBearing, setIsInterestBearing] = useState<boolean>(false);

  const address = useMemo(() => {
    if (!params.address) {
      return;
    }
    try {
      return new PublicKey(params.address);
    } catch (e) {
      console.log(`Invalid public key`, e);
    }
  }, [params]);

  useEffect(() => {
    if (address) {
      isInterestBearingAccount(connection, address).then(setIsInterestBearing);
    }
  }, [address, connection]);

  if (!address) {
    return <div>Error loading account</div>;
  }

  return (
    <div>
      <AppHero
        title={<AccountBalance address={address} />}
        subtitle={
          <div className="my-4">
            <ExplorerLink
              path={`account/${address}`}
              label={ellipsify(address.toString())}
            />
          </div>
        }
      >
        <div className="my-4">
          <AccountButtons address={address} />
        </div>
      </AppHero>
      <div className="space-y-8">
        <AccountTokens address={address} />
        <AccountTransactions address={address} />
        {isInterestBearing && <FilteredAccountTransactions address={address} />}
      </div>
      <div className="visual-spacer h-8" aria-hidden="true"></div>
    </div>
  );
}
