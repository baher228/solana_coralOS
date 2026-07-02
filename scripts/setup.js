#!/usr/bin/env node
// Generates fresh local devnet wallets for the freelance escrow demo. Safe to re-run: existing keys
// are preserved, but no secrets are committed.

import { Keypair } from '@solana/web3.js'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import bs58 from 'bs58'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = join(root, '.env')
const examplePath = join(root, '.env.example')
const walletsPath = join(root, 'WALLETS.txt')

const setKv = (text, key, value) => {
  const re = new RegExp(`^${key}=.*$`, 'm')
  return re.test(text) ? text.replace(re, `${key}=${value}`) : `${text.replace(/\s*$/, '\n')}${key}=${value}\n`
}
const getKv = (text, key) => text.match(new RegExp(`^${key}=(\\S+)`, 'm'))?.[1]

let env = existsSync(envPath) ? readFileSync(envPath, 'utf8') : readFileSync(examplePath, 'utf8')
const buyerB58 = getKv(env, 'BUYER_KEYPAIR_B58') || bs58.encode(Keypair.generate().secretKey)
const sellerB58 = getKv(env, 'SELLER_KEYPAIR_B58') || bs58.encode(Keypair.generate().secretKey)
const buyer = Keypair.fromSecretKey(bs58.decode(buyerB58)).publicKey.toBase58()
const seller = Keypair.fromSecretKey(bs58.decode(sellerB58)).publicKey.toBase58()

env = setKv(env, 'BUYER_KEYPAIR_B58', buyerB58)
env = setKv(env, 'SELLER_KEYPAIR_B58', sellerB58)
env = setKv(env, 'WALLET', seller)
env = setKv(env, 'SOLANA_RPC_URL', getKv(env, 'SOLANA_RPC_URL') || 'https://api.devnet.solana.com')
writeFileSync(envPath, env)

const block = [
  'Freelance Escrow Platform - local devnet wallets',
  `Generated: ${new Date().toISOString()}`,
  '',
  `  Employer wallet  ${buyer}   <- funds jobs if you wire live devnet escrow`,
  `  Worker   wallet  ${seller}   <- receives releases`,
  '',
  'No third-party settlement key is generated or preserved.',
  '',
].join('\n')
writeFileSync(walletsPath, block)
console.log(`\n${block}`)
console.log('Next: npm run dev')
