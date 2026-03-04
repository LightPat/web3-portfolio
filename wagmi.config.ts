// wagmi.config.ts
import { defineConfig } from '@wagmi/cli'
import { foundry } from '@wagmi/cli/plugins'  // Built-in import

export default defineConfig({
  out: 'src/constants/generated.ts',  // Output file for generated ABIs (adjust path if needed)
  plugins: [
    foundry({
      // Path to your Foundry project root (where foundry.toml is)
      // Assuming it's a sibling folder to your Next.js repo; adjust as needed (e.g., './foundry' if inside a monorepo)
      project: '../foundry-defi-stablecoin',

      // Optional: Only include your specific contracts to avoid extras (speeds up generation)
      include: [
        'DSCEngine.sol/*.json',          // For DSCEngine ABI
        'DecentralizedStableCoin.sol/*.json',  // For the DSC token ABI
      ],

      // Optional: Customize artifact dir if not default 'out/'
      // artifacts: 'out/',  // Default, so usually not needed

      // Optional: Exclude tests/scripts (docs default already handles most, like *.t.sol)
      exclude: [
        '**/*.t.sol/*.json',  // Test files
        '**/*.s.sol/*.json',  // Script files
      ],

      // Optional: Auto-build Foundry project before generating (default: true)
      forge: {
        build: true,    // Runs 'forge build' automatically
        clean: false,   // Don't clean cache unless needed
        rebuild: true,  // Rebuild on file changes in watch mode
      },

      // Optional: Prefix contract names to avoid collisions (e.g., if multiple projects)
      // namePrefix: 'dsc',

      // Optional: Add deployments for specific chains (e.g., mainnet, Sepolia)
      // deployments: {
      //   DSCEngine: {
      //     1: '0xYourMainnetAddress',  // Chain ID 1 = Ethereum mainnet
      //     11155111: '0x0165878A594ca255338adfa4d48449f69242Eb8F',  // Sepolia
      //   },
      // },
    }),
  ],
})