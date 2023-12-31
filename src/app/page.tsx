"use client";
import { useState, useEffect } from 'react';
import type { UserData } from '@stacks/connect';
import { AppConfig, UserSession, showConnect, } from "@stacks/connect";
import { StacksTestnet } from "@stacks/network";
import { bytesToHex, hexToBytes } from '@stacks/common';
import { sbtcDepositHelper, WALLET_00 } from 'sbtc';
import * as btc from '@scure/btc-signer';

// Network configuration
import { NETWORK } from './netconfig';

// Library
import type { stateType, walletType, depositInfoType } from './lib';
import { emptyWallet, emptyDepositInfo } from './lib';
import { getBalanceSBTC, transactionConfirmed, getURLAddressBTC,
  getURLAddressSTX, getURLTxBTC, getFeeRate } from './lib';
import { humanReadableNumber as hrn } from './lib';

// UI
import { LogWindow } from './logwindow';
import { Alert, Badge, Banner, Button, Card, Spinner } from 'flowbite-react';

// Setting: How much to deposit
const DEPOSITAMOUNT : number = 10_000;

// Main component
export default function Home() {
  // State and wallet
  const [state, setState] = useState<stateType>("DISCONNECTED");
  const [wallet, setWallet] = useState<walletType>(emptyWallet);
  const [depositInfo, setDepositInfo] = useState<depositInfoType>(emptyDepositInfo);
  const [userData, setUserData] = useState<UserData | null>(null);
  
  // Reset application
  const reset = () : void => {
    setState("DISCONNECTED");
    setWallet(emptyWallet);
    setDepositInfo(emptyDepositInfo);
    setUserData(null);
    if (userSession) {
      userSession.signUserOut();
    }
  }
  
  // Connect with Leather/Hiro Wallet
  const appConfig = new AppConfig();
  const userSession = new UserSession({ appConfig });

  useEffect(() => {
    if (userSession.isSignInPending()) {
      userSession.handlePendingSignIn().then((userData) => {
        setUserData(userData);
      });
    } else if (userSession.isUserSignedIn()) {
      setUserData(userSession.loadUserData());
    }
  }, []);

  // Retrieve necessary information from the wallet and from the network
  // This method depends on the network we are on. For now, it is implemented
  // for the local Development Network.
  const getWalletAndDepositDetails = async (userData:UserData) => {
    const bitcoinAccountA = await NETWORK.getBitcoinAccount(WALLET_00);
    const addressBTC = bitcoinAccountA.wpkh.address;
    const addressSTX = userData.profile.stxAddress.testnet;
    const balanceBTC = await NETWORK.getBalance(addressBTC);
    setWallet({ ...wallet, 
      decentralizedId: userData.decentralizedID , 
      addressSTX: addressSTX,
      addressBTC: addressBTC,
      publicKeyBTC: bitcoinAccountA.publicKey.buffer.toString(),
      balanceBTC: balanceBTC,
      balanceSBTC: await getBalanceSBTC(addressSTX),
    });
    // Deposit Information
    const feeRate = await getFeeRate();
    setDepositInfo({ ...depositInfo,
      addressPeg: await NETWORK.getSbtcPegAddress(),
      feeRate: feeRate,
    });
    if ((balanceBTC + feeRate * 1_000) > DEPOSITAMOUNT) {
      setState("READY");
    } else {
      setState("INSUFFICIENT_FUNDS");
    }
  }

  // Hook to get wallet and network information.
  useEffect(() => {
    if (userData) {
      if(!!userData.profile) {
        setState("CONNECTING");
        getWalletAndDepositDetails(userData);
      }
    }
  }, [userData]);

  // Hook to connect to the Leather wallet
  const connectWallet = () => {
    showConnect({
      userSession,
      network: StacksTestnet,
      appDetails: {
        name: "sBTC Deposit",
        icon: "https://freesvg.org/img/bitcoin.png",
      },
      onFinish: () => {
        window.location.reload();
      },
      onCancel: () => {
        reset();
      },
    });
  }

  // Continue fetching sBTC and BTC balance
  const fetchBalanceForever = async () => {
    const balanceBTC = await NETWORK.getBalance(wallet.addressBTC as string);
    const balanceSBTC = await getBalanceSBTC(wallet.addressSTX as string);
    setWallet({ ...wallet, balanceBTC: balanceBTC, balanceSBTC: balanceSBTC });
  }

  // Check transaction
  const waitUntilConfirmed = async (txid : string, intervalId : NodeJS.Timeout) => {
    const confirmed = await transactionConfirmed(txid);
    if (confirmed) {
      setState("CONFIRMED");
      clearInterval(intervalId);
      setInterval(() => {
        fetchBalanceForever();
      }, 10000);
    }
  }

  // Hook to check for confirmations
  const waitForConfirmation = (txid : string) => {
    const intervalId = setInterval(() => {
      waitUntilConfirmed(txid, intervalId);
    }, 10000);
  }

  // Hook to start deposit
  const deposit = async () => {
    const tx = await sbtcDepositHelper({
      // pegAddress: sbtcPegAddress,
      stacksAddress:        wallet.addressSTX as string,
      amountSats:           DEPOSITAMOUNT,
      feeRate:              await getFeeRate(),
      utxos:                await NETWORK.fetchUtxos(wallet.addressBTC as string),
      bitcoinChangeAddress: wallet.addressBTC as string,
    });
    setDepositInfo({ ...depositInfo, tx: tx });
    // Sign and broadcast
    const psbt = tx.toPSBT();
    const requestParams = {
      publicKey: wallet.publicKeyBTC as string,
      hex: bytesToHex(psbt),
    };
    const txResponse = await window.btc.request("signPsbt", requestParams);
    const formattedTx = btc.Transaction.fromPSBT(
      hexToBytes(txResponse.result.hex)
    );
    formattedTx.finalize();
    const finalTx : string = await NETWORK.broadcastTx(formattedTx);
    setDepositInfo({ ...depositInfo, finalTx: finalTx });
    // Wait for confirmatins
    setState("REQUEST_SENT");
    waitForConfirmation(finalTx);
  }

  // Main component
  return (
    <main>
      <Banner>
        <div className="fixed top-0 left-0 z-50 flex justify-between w-full p-4 border-b border-gray-200 bg-gray-50 dark:bg-gray-700 dark:border-gray-600">
          <div className="flex items-center mx-auto">
            <p className="flex items-center text-sm font-bold text-red-500 dark:text-red-400">
              <span>
                {
                  (state != "DISCONNECTED" && state != "CONNECTING") ? (
                    <>You currently hold {hrn(wallet.balanceBTC as number)} BTCs and {hrn(wallet.balanceSBTC as number)} in sBTC.</>
                  ) : (
                      (state == "DISCONNECTED") ? (
                        <>Connect to proceed</>
                      ) : (
                          <>Loading ...</>
                        )
                    )
                }
              </span>
            </p>
          </div>
        </div>
      </Banner>
      <div className="h-screen flex flex-col">
        <div className="grow flex items-center justify-center bg-gradient-to-b from-gray-500 to-black">
          <Card className="w-1/2">
            <h1 className="text-4xl font-bold text-black">
              <p>
                Deposit your satoshis.
              </p>
            </h1>
            <div className="text-regular">
              <p>
                Transfer {hrn(DEPOSITAMOUNT)} satoshis to the peg-in.
              </p>
            </div>
            <div>
              { 
                (state == "DISCONNECTED") ? (
                  <Button
                    onClick={connectWallet}
                  >
                    Connect Wallet
                  </Button>
                ) : null
              }
              {
                (state == "CONNECTING") ? (
                  <Alert
                    withBorderAccent
                    className="w-full"
                  >
                    <span>
                      <p>
                        <span>
                          <Spinner aria-label="Loading..." />
                        </span>
                        &nbsp;&nbsp;
                        Loading necessary data from your wallet and the chain...
                      </p>
                    </span>
                  </Alert>
                ) : null
              }
              {
                (state == "READY") ? (
                  <>
                    <span className="py-2">
                      <Alert
                        withBorderAccent
                        className="w-full"
                      >
                        <span>
                          The sats will be sent from your&nbsp;
                          <a 
                            href={getURLAddressBTC(wallet.addressBTC as string)} 
                            target="_blank"
                            className="underline text-blue-600 hover:text-blue-800 visited:text-purple-600"
                          >
                            BTC address
                          </a>
                          &nbsp; to the&nbsp;
                          <a
                            href={getURLAddressBTC(depositInfo.addressPeg as string)} 
                            target="_blank"
                            className="underline text-blue-600 hover:text-blue-800 visited:text-purple-600"
                          >
                            peg address.
                          </a>
                          &nbsp;You will recieve the equal amount of sBTC to your&nbsp;
                          <a
                            href={getURLAddressSTX(wallet.addressSTX as string)}
                            target="_blank"
                            className="underline text-blue-600 hover:text-blue-800 visited:text-purple-600"
                          >
                            STX Address.
                          </a>
                        </span>
                        <span className="flex justify-end">
                          <Badge
                            color="warning"
                          >
                            {depositInfo.feeRate as number} sat/vB fee
                          </Badge>
                        </span>
                      </Alert>
                    </span>
                    <span>
                      <Button.Group>
                        <Button
                          onClick={deposit}
                        >
                          Deposit
                        </Button>
                        <Button
                          onClick={reset}
                        >
                          Disconnect Wallet
                        </Button>
                      </Button.Group>
                    </span>
                  </>
                ) : null
              }
              {
                (state == "INSUFFICIENT_FUNDS") ? (
                  <>
                    <span className="py-2">
                      <Alert
                        color="failure"
                        withBorderAccent
                        className="w-full items-center"
                      >
                        <p>
                          Your BTC account does not contain enough Satoshis.
                          Top it up before proceeding.
                        </p>
                      </Alert>
                    </span>
                    <span>
                      <Button
                        onClick={reset}
                      >
                        Disconnect Wallet
                      </Button>
                    </span>
                  </>
                ) : null
              }
              {
                (state == "REQUEST_SENT") ? (
                  <Alert
                    withBorderAccent
                    className="w-full"
                  >
                    <span>
                      <p>
                        <span>
                          <Spinner aria-label="Waiting for transaction" />
                        </span>
                        &nbsp;&nbsp;
                        Waiting for confirmations (see&nbsp;
                        <a 
                          href={getURLTxBTC(depositInfo.finalTx as string)}
                          target="_blank"
                          className="underline text-blue-600 hover:text-blue-800 visited:text-purple-600"
                        >
                          transaction details
                        </a>
                        )
                      </p>
                    </span>
                  </Alert>
                ) : null
              }
              {
                (state == "CONFIRMED") ? (
                  <>
                    <span className="py-2">
                      <Alert
                        withBorderAccent
                        color="success"
                        className="w-full"
                      >
                        <span>
                          <p>
                            Transaction confirmed (see&nbsp;
                            <a 
                              href={getURLTxBTC(depositInfo.finalTx as string)}
                              target="_blank"
                              className="underline text-blue-600 hover:text-blue-800 visited:text-purple-600"
                            >
                              transaction details
                            </a>
                            )
                          </p>
                        </span>
                      </Alert>
                    </span>
                    <span>
                      <Button
                        onClick={reset}
                      >
                        Disconnect Wallet
                      </Button>
                    </span>
                  </>
                ) : null
              }
            </div>
          </Card>
        </div>
        <LogWindow
          wallet = { wallet }
          depositInfo = { depositInfo }
          state={ state }
          />
      </div>
    </main>
  )
}
