import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import {
  arbitrum,
  base,
  mainnet,
  optimism,
  polygon,
  sepolia,
  foundry
} from 'wagmi/chains';

export const config = getDefaultConfig({
  appName: 'Web3-Portfolio',
  projectId: '448fcf93b2a9c65beeac097214c050d3',
  chains: [
    sepolia,
    foundry,
    ...(process.env.NEXT_PUBLIC_ENABLE_TESTNETS === 'true' ? [sepolia] : []),
  ],
  ssr: true,
});
