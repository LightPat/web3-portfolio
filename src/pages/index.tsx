import { ConnectButton } from '@rainbow-me/rainbowkit';
import type { NextPage } from 'next';
import Head from 'next/head';
import styles from '../styles/Home.module.css';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { formatUnits, parseUnits } from 'viem';
import { DSC_ENGINE_ABI, DECENTRALIZED_STABLE_COIN_ABI } from '../constants/generated';
import { DSC_ENGINE_ADDRESS, WETH_ADDRESS } from '../constants/constants';
import { Popover, Transition, PopoverButton, PopoverPanel } from '@headlessui/react'
import { Fragment, useState, useEffect } from 'react'
import { QuestionMarkCircleIcon } from '@heroicons/react/24/outline'
import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Rectangle } from 'recharts';

const Home: NextPage = () => {
  const { address, isConnected } = useAccount();

  const { data, isLoading, error } = useReadContract({
    address: DSC_ENGINE_ADDRESS,
    abi: DSC_ENGINE_ABI,
    functionName: 'getAccountInformation',
    args: [address!]
  })

  let totalDscMinted = 0n
  let collateralValueInUsd = 0n

  if (data) {
    [totalDscMinted, collateralValueInUsd] = data
  }

  const { data: healthFactorRaw } = useReadContract({
    address: DSC_ENGINE_ADDRESS,
    abi: DSC_ENGINE_ABI,
    functionName: 'getHealthFactor',
    args: [address!]
  })

  const healthFactor = healthFactorRaw 
    ? parseFloat(formatUnits(healthFactorRaw as bigint, 18)).toFixed(2) 
    : "0.00";

  // User inputs (use controlled inputs instead of uncontrolled for real app)
  const [depositAmount, setDepositAmount] = useState<string>('');     // e.g. "1.5"
  const [mintAmount, setMintAmount] = useState<string>('');           // e.g. "750"

  // Convert to wei (18 decimals — adjust if your WETH/DSC uses different)
  const depositWei = depositAmount ? parseUnits(depositAmount, 18) : 0n;
  const mintWei = mintAmount ? parseUnits(mintAmount,   18) : 0n;

  // A. Read current allowance (WETH → DSCEngine)
  const { data: allowanceRaw, refetch: refetchAllowance } = useReadContract({
    address: WETH_ADDRESS,
    abi: DECENTRALIZED_STABLE_COIN_ABI,
    functionName: 'allowance',
    args: [address!, DSC_ENGINE_ADDRESS],
    // only query if connected + inputs exist
    query: { enabled: isConnected && !!address && depositWei > 0n },
  });

  const allowance = allowanceRaw ?? 0n;

  // B. Prepare approve write
  const { 
    writeContract: writeApprove, 
    isPending: isApproving,
    data: approveTxHash 
  } = useWriteContract();

  // C. Wait for approval confirmation
  const { isSuccess: approveSuccess, isLoading: isConfirmingApproval } = useWaitForTransactionReceipt({
    hash: approveTxHash,
  });

  // D. Prepare depositAndMint write (only when we know allowance is enough)
  const { 
    writeContract: writeDepositAndMint, 
    isPending: isMinting,
    data: mintTxHash 
  } = useWriteContract();

  // Optional: wait for mint tx too
  const { isSuccess: mintSuccess, isLoading: isConfirmingMint } = useWaitForTransactionReceipt({
    hash: mintTxHash,
  });

  const [isApprovalPending, setIsApprovalPending] = useState(false);
  const [isConsumptionPending, setIsConsumptionPending] = useState(false);
  const isAllowanceUpdating = isApprovalPending || isConsumptionPending;

  // NEW: Store snapshots when tx is SENT (not when mined)
  const [preApprovalAllowance, setPreApprovalAllowance] = useState<bigint | null>(null);
  const [preMintAllowance, setPreMintAllowance] = useState<bigint | null>(null);

  // ────────────────────────────────────────────────
  // APPROVAL FLOW
  // ────────────────────────────────────────────────
  useEffect(() => {
    if (approveTxHash && !approveSuccess && allowance !== null) {
      setIsApprovalPending(true);
      setPreApprovalAllowance(allowance); // snapshot BEFORE mining
    }
  }, [approveTxHash, approveSuccess, allowance]);

  useEffect(() => {
    if (approveSuccess) {
      const interval = setInterval(() => {
        refetchAllowance();
        if (allowance > (preApprovalAllowance ?? 0n)) { // increased from snapshot
          setIsApprovalPending(false);
          setPreApprovalAllowance(null); // cleanup
          clearInterval(interval);
        }
      }, 800); // slightly faster for local dev

      return () => clearInterval(interval);
    }
  }, [approveSuccess, allowance, preApprovalAllowance, refetchAllowance]);

  // ────────────────────────────────────────────────
  // MINT / DEPOSIT FLOW
  // ────────────────────────────────────────────────
  useEffect(() => {
    if (mintTxHash && !mintSuccess && allowance !== null) {
      setIsConsumptionPending(true);
      setPreMintAllowance(allowance); // snapshot BEFORE mining
    }
  }, [mintTxHash, mintSuccess, allowance]);

  useEffect(() => {
    if (mintSuccess) {
      const interval = setInterval(() => {
        refetchAllowance();
        if (
          preMintAllowance !== null &&
          allowance < preMintAllowance // decreased from snapshot
        ) {
          setIsConsumptionPending(false);
          setPreMintAllowance(null); // cleanup
          clearInterval(interval);
        }
      }, 800);

      return () => clearInterval(interval);
    }
  }, [mintSuccess, allowance, preMintAllowance, refetchAllowance]);

  // Safety net: force reset if stuck too long (e.g. 45s)
  useEffect(() => {
    if (isAllowanceUpdating) {
      const safety = setTimeout(() => {
        setIsApprovalPending(false);
        setIsConsumptionPending(false);
        setPreApprovalAllowance(null);
        setPreMintAllowance(null);
        console.warn("Allowance pending timeout - forced reset");
      }, 45000);

      return () => clearTimeout(safety);
    }
  }, [isAllowanceUpdating]);

  // Mock data representing how many users/positions are at various health factors.
  // A health factor < 1.0 means they are undercollateralized and liquidatable.
  const healthDistributionData = [
    { range: '< 1.0', users: 2, fill: '#ef4444' },    // Danger: Red-500
    { range: '1.0 - 1.2', users: 12, fill: '#f59e0b' }, // Warning: Amber-500
    { range: '1.2 - 1.5', users: 28, fill: '#10b981' }, // Safe: Emerald-500
    { range: '1.5 - 2.0', users: 45, fill: '#34d399' }, // Very Safe: Emerald-400
    { range: '2.0+', users: 31, fill: '#6ee7b7' },      // Overcollateralized: Emerald-300
  ];

  return (
    <div className="relative min-h-screen overflow-hidden">

      <Head>
        <title>Web3 Portfolio</title>
        <meta
          content="Generated by @rainbow-me/create-rainbowkit"
          name="description"
        />
        <link href="/favicon_io/favicon.ico" rel="icon" />
      </Head>

      {/* Animated background layer – full screen, behind everything */}
      <div className="fixed inset-0 bg-animated -z-10" />

      {/* --- HEADER --- */}
      <header className="glass-header sticky top-0 z-20">
        {/* This div creates full-viewport-width black background */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">  {/* ← top/bottom padding here */}
          <div className="flex flex-wrap justify-between items-center gap-3 sm:gap-4">
            <div className="flex items-center gap-2">
              <div>
                <h1 className="text-xl font-bold tracking-widest text-indigo-500 font-mono">DSC_TERMINAL_v1.0</h1>
                <p className="text-zinc-500 text-xs uppercase tracking-tighter">Stablecoin Protocol & Risk Analytics</p>
              </div>

              {/* ← Help Popover here */}
              <Popover className="relative">
                {({ open }) => (
                  <>
                    <PopoverButton className="p-1 rounded-full hover:bg-indigo-950/40 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/50">
                      <QuestionMarkCircleIcon className="h-5 w-5 text-indigo-400 hover:text-indigo-300" />
                    </PopoverButton>

                    <Transition
                      as={Fragment}
                      enter="transition ease-out duration-150"
                      enterFrom="opacity-0 translate-y-1"
                      enterTo="opacity-100 translate-y-0"
                      leave="transition ease-in duration-100"
                      leaveFrom="opacity-100 translate-y-0"
                      leaveTo="opacity-0 translate-y-1"
                    >
                      <PopoverPanel className="
                        absolute left-1/2 -translate-x-1/2 mt-2 w-80 sm:w-96
                        border border-indigo-500/30 rounded-lg shadow-2xl
                        text-zinc-200 text-sm
                        overflow-hidden z-30
                        bg-zinc-950/95
                      ">
                        <div className="p-5 space-y-4">
                          <h3 className="font-semibold text-indigo-400 text-base">
                            DSC Protocol Overview
                          </h3>

                          <p>
                            Decentralized StableCoin (DSC) is an over-collateralized, decentralized stablecoin protocol built with Foundry.
                          </p>

                          <ul className="space-y-2 text-zinc-400 text-xs leading-relaxed">
                            <li>• Pegged to 1 USD via algorithmic mechanisms</li>
                            <li>• Collateral: ETH, BTC wrappers, stable LP tokens</li>
                            <li>• Liquidation engine with health factor monitoring</li>
                            <li>• Risk analytics dashboard (TVL, collateral ratio, liquidation risk)</li>
                            <li>Audited (or in progress) – use at your own risk</li>
                          </ul>

                          <div className="pt-2 border-t border-zinc-700/50 text-center">
                            <a
                              href="https://github.com/LightPat/foundry-defi-stablecoin"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-indigo-400 hover:text-indigo-300 text-xs underline"
                            >
                              View GitHub repo & documentation →
                            </a>
                          </div>
                        </div>
                      </PopoverPanel>
                    </Transition>
                  </>
                )}
              </Popover>
            </div>
            
            <ConnectButton
              showBalance={{ smallScreen: false, largeScreen: false }}
              chainStatus={{ smallScreen: "icon", largeScreen: "full" }}
              accountStatus={{ smallScreen: "avatar", largeScreen: "full" }}
            />

            <a
              href="https://etherscan.io/address/YOUR_CONTRACT_ADDRESS_HERE"  // ← replace with real link
              target="_blank"
              rel="noopener noreferrer"
              className="
                px-3 py-1.5 text-xs font-medium
                text-indigo-400 hover:text-indigo-300
                bg-indigo-950/40 hover:bg-indigo-900/50
                border border-indigo-500/30 hover:border-indigo-400/50
                rounded-md transition-colors duration-150
                whitespace-nowrap
              "
            >
              View on Etherscan ↗
            </a>
          </div>
        </div>
      </header>

      {/* All your visible content – sits on top */}
      <div className={styles.container + " relative z-0"} style={{ paddingTop: '8px' }}>
        
        {/* --- MAIN BENTO GRID --- */}
        <main className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-4 auto-rows-min">
          
          {/* 1. IDENTITY BOX (Span 4) */}
          <div className="md:col-span-4 bg-zinc-900/50 border border-zinc-800 p-6 rounded-2xl flex flex-col justify-between">
            <div>
              {/* Header with avatar + name/title side-by-side */}
              <div className="flex items-center gap-4 sm:gap-5 mb-5">
                <div className="flex-shrink-0">
                  <img
                    src="/images/Professional_Headshot.jpg"
                    alt="Patrick's Profile"
                    className="w-20 h-20 sm:w-24 sm:h-24 object-cover rounded-full border-2 border-blue-500"
                  />
                </div>
                
                <div className="min-w-0">
                  <h2 className="text-2xl font-bold leading-tight">Patrick Seeman</h2>
                  <p className="text-indigo-400 font-mono text-sm mt-0.5">Solidity Developer</p>

                  {/* Social links – added here */}
                  <div className="flex gap-3 mt-3">
                    <a
                      href="https://www.linkedin.com/in/patrick-seeman-5842841a0/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-400 hover:text-blue-500 transition-colors"
                      aria-label="LinkedIn profile"
                    >
                      <img 
                        src="/images/InBug-White.png" 
                        alt="LinkedIn" 
                        className="w-7 h-7 sm:w-8 sm:h-8 object-contain" // adjust size to match your design
                      />
                    </a>
                    
                    <a
                      href="https://github.com/LightPat"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-400 hover:text-gray-200 transition-colors"
                      aria-label="GitHub profile"
                    >
                      <img 
                        src="/images/GitHub_Invertocat_White.png" 
                        alt="GitHub" 
                        className="w-7 h-7 sm:w-8 sm:h-8 object-contain"
                      />
                    </a>
                  </div>
                </div>
              </div>
              <p className="text-indigo-400 font-mono text-sm">Smart Contract Engineer | Solidity & Foundry</p>
              <p className="text-zinc-400 mt-4 text-sm leading-relaxed">
                Building secure smart contracts & DeFi protocols. Foundry expert with hands-on projects in stablecoins and NFT collections. Background in high-stakes data engineering and ML at Cleveland Clinic.
              </p>
            </div>
            <div className="mt-8 flex gap-3">
              <a href="https://github.com/LightPat/foundry-defi-stablecoin" target="_blank" rel="noopener noreferrer" className="inline-block hover:opacity-90 transition-opacity"><span className="px-3 py-1 bg-zinc-800 rounded-full text-xs border border-zinc-700">Solidity</span></a>
              <a href="https://www.getfoundry.sh/" target="_blank" rel="noopener noreferrer" className="inline-block hover:opacity-90 transition-opacity"><span className="px-3 py-1 bg-zinc-800 rounded-full text-xs border border-zinc-700">Foundry</span></a>
              <a href="https://github.com/LightPat/Mobilenet-Image-Classification" target="_blank" rel="noopener noreferrer" className="inline-block hover:opacity-90 transition-opacity"><span className="px-3 py-1 bg-zinc-800 rounded-full text-xs border border-zinc-700">Python</span></a>
              <a href="https://play.google.com/store/apps/details?id=com.GridlockGames.ViTheGame&hl=en_US" target="_blank" rel="noopener noreferrer" className="inline-block hover:opacity-90 transition-opacity"><span className="px-3 py-1 bg-zinc-800 rounded-full text-xs border border-zinc-700">C#</span></a>
              <a href="https://aws.amazon.com/what-is/sql/" target="_blank" rel="noopener noreferrer" className="inline-block hover:opacity-90 transition-opacity"><span className="px-3 py-1 bg-zinc-800 rounded-full text-xs border border-zinc-700">SQL</span></a>
            </div>
          </div>

          {/* 2. MINT INTERFACE (Span 5) */}
          <div className="md:col-span-5 bg-zinc-900 border border-indigo-500/20 p-6 rounded-2xl shadow-xl shadow-indigo-500/5">
            <h3 className="text-sm font-mono text-indigo-400 mb-6 uppercase tracking-widest flex items-center gap-2">
              <span className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse"></span>
              Execute_Mint
            </h3>
            <div className="space-y-4">
              <div className="group">
                <label className="text-[10px] text-zinc-500 uppercase ml-1">Deposit WETH</label>
                <input 
                  type="number" 
                  className="w-full bg-black border border-zinc-800 p-4 rounded-xl mt-1 focus:border-indigo-500 transition-all outline-none font-mono text-lg" 
                  placeholder="0.00" 
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                />
              </div>
              <div>
                <label className="text-[10px] text-zinc-500 uppercase ml-1">Mint DSC</label>
                <input 
                  type="number" 
                  className="w-full bg-black border border-zinc-800 p-4 rounded-xl mt-1 focus:border-indigo-500 transition-all outline-none font-mono text-lg" 
                  placeholder="0.00" 
                  value={mintAmount}
                  onChange={(e) => setMintAmount(e.target.value)}
                />
              </div>

              {depositWei > 0n && mintWei > 0n ? (
                allowance < depositWei ? (
                  <button
                    onClick={() => 
                      writeApprove({
                        address: WETH_ADDRESS,
                        abi: DECENTRALIZED_STABLE_COIN_ABI,
                        functionName: 'approve',
                        args: [DSC_ENGINE_ADDRESS, depositWei * 110n / 100n], // slight buffer ~10%
                      })
                    }
                    disabled={isApproving || isConfirmingApproval || isAllowanceUpdating || !isConnected}
                    className="w-full bg-yellow-600 hover:bg-yellow-500 text-white font-bold py-4 rounded-xl transition-all active:scale-[0.98] shadow-lg shadow-yellow-600/20 mt-2 disabled:opacity-50"
                  >
                    {isApproving ? 'Waiting for wallet...' :
                    isConfirmingApproval ? 'Confirming...' :
                    isAllowanceUpdating ? "Updating allowance..." :
                    'Approve WETH'}
                  </button>
                ) : (
                  <button
                    onClick={() => 
                      writeDepositAndMint({
                        address: DSC_ENGINE_ADDRESS,
                        abi: DSC_ENGINE_ABI,           // your full engine ABI
                        functionName: 'depositCollateralAndMintDsc',
                        args: [WETH_ADDRESS, depositWei, mintWei],
                      })
                    }
                    disabled={isMinting || isConfirmingMint || isAllowanceUpdating || !isConnected}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 rounded-xl transition-all active:scale-[0.98] shadow-lg shadow-indigo-600/20 mt-2 disabled:opacity-50"
                  >
                    {isMinting ? 'Processing...' :
                    isConfirmingMint ? 'Confirming...' :
                    isAllowanceUpdating ? "Updating allowance..." :
                    'DEPOSIT & MINT'}
                  </button>
                )
              ) : (
                <button disabled className="w-full bg-zinc-700 text-zinc-400 font-bold py-4 rounded-xl mt-2 cursor-not-allowed">
                  Enter amounts to continue
                </button>
              )}

              {/* Optional feedback */}
              {/* {approveSuccess && <p className="text-green-400 text-sm mt-2">Approval successful! You can now mint.</p>}
              {mintSuccess && <p className="text-green-400 text-sm mt-2">Deposit & Mint completed!</p>} */}
            </div>
          </div>

          {/* 3. QUICK HEALTH STAT (Span 3) */}
          <div className="md:col-span-3 bg-zinc-900 border border-zinc-800 p-6 rounded-2xl flex flex-col justify-center items-center text-center">
            <h3 className="text-[10px] text-zinc-500 uppercase mb-4 tracking-[0.2em]">Account_Safety</h3>
            <div className={`text-5xl font-mono font-bold ${Number(healthFactor) > 1.5 && totalDscMinted > 0 ? 'text-emerald-500' : 'text-amber-500'}`}>
              {isConnected && totalDscMinted > 0 ? healthFactor : "---"}
            </div>
            <p className="text-zinc-500 text-[10px] mt-2 font-mono">Health Factor</p>
            <div className="w-full bg-zinc-800 h-1.5 mt-6 rounded-full overflow-hidden">
              <div 
                className={`h-full transition-all duration-1000 ${Number(healthFactor) > 1.5 && totalDscMinted > 0 ? 'bg-emerald-500' : 'bg-amber-500'}`} 
                style={{ width: isConnected && totalDscMinted > 0 ? `${Math.min(Number(healthFactor) * 20, 100)}%` : '0%' }}
              ></div>
            </div>
          </div>

          {/* 4. ANALYTICS DASHBOARD (Span 8) */}
          <div className="md:col-span-8 bg-zinc-900/30 border border-zinc-800 p-6 rounded-2xl min-h-[300px]">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-sm font-mono text-emerald-400 uppercase tracking-widest">Protocol_Metrics</h3>
              <div className="text-[10px] text-zinc-500 font-mono">LIVE_ANVIL_FEED</div>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <StatCard label="Total Value Locked" value="$1.24M" />
              <StatCard label="DSC Supply" value="840.2k" />
              <StatCard label="ETH Price" value="$2,450.00" />
              <StatCard label="Collateral Ratio" value="154%" />
            </div>

            {/* Health Distribution Chart */}
            <div className="mt-2">
              {/* FIX 3: Added 'text-center' to this header class */}
              <h4 className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-4 text-center">
                System Health Distribution (Users)
              </h4>
              
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart 
                    data={healthDistributionData} 
                    margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                  >
                    <XAxis 
                      dataKey="range" 
                      stroke="#52525b" 
                      fontSize={12} 
                      tickLine={false} 
                      axisLine={false} 
                      fontFamily="monospace"
                    />
                    <YAxis 
                      stroke="#52525b" 
                      fontSize={12} 
                      tickLine={false} 
                      axisLine={false}
                      fontFamily="monospace" 
                    />
                    <Tooltip
                      cursor={{ fill: '#27272a', opacity: 0.4 }}
                      contentStyle={{ 
                        backgroundColor: '#18181b',
                        borderColor: '#27272a',    
                        borderRadius: '12px', 
                        color: '#a1a1aa',          
                        fontFamily: 'monospace',
                        fontSize: '12px' 
                      }}
                      itemStyle={{ color: '#34d399', fontWeight: 'bold' }}
                      // FIX 1: Updated type to number | undefined and added a fallback (value || 0)
                      formatter={(value: number | undefined) => [`${value || 0} Users`, 'Positions']}
                      labelStyle={{ color: '#d4d4d8', marginBottom: '4px' }}
                    />
                    {/* FIX 2: Used shape prop with Rectangle instead of mapping Cell components */}
                    <Bar 
                      dataKey="users" 
                      shape={(props: any) => {
                        // Destructure payload to get our custom fill color, pass the rest to Rectangle
                        const { payload, ...rest } = props;
                        return <Rectangle {...rest} fill={payload.fill} radius={[4, 4, 0, 0]} />;
                      }} 
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* 5. EXPERIENCE LOG (Span 4) */}
          <div className="md:col-span-4 bg-zinc-900/30 border border-zinc-800 p-6 rounded-2xl">
            <h3 className="text-sm font-mono text-zinc-400 mb-6 uppercase tracking-widest">Experience_Log</h3>
            <ul className="space-y-6">
              <ExperienceItem 
                title="Research Data Scientist I" 
                org="Cleveland Clinic" 
                period="February 2026 - Present"
                desc="Restructured data warehouse for more optimal queries and ease of use for clinical studies"
              />
              <ExperienceItem 
                title="Lead Developer" 
                org="GridLock Games" 
                period="March 2023 - November 2025"
                desc="Led cross-platform MMORPG development in an agile environment, ensuring on-time feature delivery and team coordination."
              />
              <ExperienceItem 
                title="Data Scientist I" 
                org="Cleveland Clinic"
                period="September 2023 - February 2025"
                desc="Built ML language model to extract structured data from pathology reports, improving data accessibility for research and clinical use."
              />
              <ExperienceItem 
                title="Associate Data Scientist" 
                org="Cleveland Clinic"
                period="June 2022 - September 2023"
                desc="Developed Python web app to automate clinical scheduling at Taussig Cancer Institute, reducing manual scheduling errors and staff time."
              />
              <ExperienceItem 
                title="Machine Learning Intern" 
                org="Cleveland Clinic"
                period="May 2021 - May 2022"
                desc="Implemented Python/TensorFlow pipelines for image recognition models, training neural networks on 51,000 insurance card images."
              />
            </ul>
          </div>
        </main>

        <footer className="max-w-7xl mx-auto mt-12 pb-8 text-center text-zinc-600 text-[10px] uppercase tracking-widest">
          &copy; 2026 Patrick Seeman // Engineered for Stability
        </footer>
      </div>
    </div>
  );
};

// Small helper components to keep code clean
function StatCard({ label, value }: { label: string, value: string }) {
  return (
    <div className="bg-black/40 border border-zinc-800 p-3 rounded-lg">
      <div className="text-[9px] text-zinc-500 uppercase mb-1">{label}</div>
      <div className="text-sm font-mono font-bold text-zinc-200">{value}</div>
    </div>
  );
}

function ExperienceItem({ title, org, period, desc }: { title: string, org: string, period: string, desc: string }) {
  return (
    <div className="border-l-2 border-zinc-800 pl-4 pb-1"> {/* pb-1 optional – breathing room between items */}
      <div className="flex justify-between items-baseline gap-4">
        <div className="text-sm font-semibold text-zinc-100">
          {title}
        </div>
        <div className="text-[13px] text-zinc-500 font-medium shrink-0 whitespace-nowrap">
          {period}
        </div>
      </div>

      {/* Organization on its own line – lighter & smaller */}
      <div className="text-[12px] text-zinc-400 mt-0.5 mb-1.5">
        {org}
      </div>

      {desc && (
        <div className="text-[11px] text-zinc-400 leading-relaxed">
          {desc}
        </div>
      )}
    </div>
  );
}

export default Home;
