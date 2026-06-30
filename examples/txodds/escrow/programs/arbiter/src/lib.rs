//! Arbiter — the trustless wrapper over the escrow (settlement spine).
//!
//! The base escrow is **buyer-released**: only the buyer signs `release`/`refund`, so a buyer could
//! take delivery and refund. This program fixes that asymmetry **without touching the deployed escrow**,
//! using the documented vault-as-buyer pattern (see `../../contract_extension.md`):
//!
//!   - `open`  — the payer funds a **vault PDA** (system-owned, derived from the order `reference`),
//!               then CPIs `escrow.initialize` signing *as the vault*, so the vault is the escrow's buyer.
//!   - the payer now has **no on-chain power** over the funds; only the configured **arbiter** does:
//!   - `arbitrate_release` — the arbiter attests delivery → CPI `escrow.release` → the seller is paid.
//!   - `arbitrate_refund`  — after the deadline, the arbiter refunds → funds swept back to the payer.
//!
//! So the seller is protected (the buyer can't unilaterally refund), and the arbiter is the neutral
//! gate. Trust moves from "the buyer's goodwill" to "a neutral arbiter agent" — still a trusted third
//! party (a production system would stake/decentralize it), but trustless *between buyer and seller*.

use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

use escrow::cpi::accounts::{Initialize as EscrowInit, Refund as EscrowRefund, Release as EscrowRelease};
use escrow::cpi::{initialize as escrow_initialize, refund as escrow_refund, release as escrow_release};
use escrow::program::Escrow as EscrowProgram;
use escrow::Escrow as EscrowState;

declare_id!("FJtuVXsyXuRKqgJBEPAXmktkd13CqStapgevzGwYktXd");

#[program]
pub mod arbiter {
    use super::*;

    /// One-time: record who the neutral arbiter is.
    pub fn init_config(ctx: Context<InitConfig>, arbiter: Pubkey) -> Result<()> {
        ctx.accounts.config.arbiter = arbiter;
        ctx.accounts.config.bump = ctx.bumps.config;
        Ok(())
    }

    /// Open an arbitrated order: fund the vault PDA, then deposit into escrow with the vault as the
    /// escrow's `buyer`. The payer cannot later release or refund — only the arbiter can.
    pub fn open(ctx: Context<Open>, amount: u64, reference: Pubkey, deadline: i64) -> Result<()> {
        // 1) Move (deposit + escrow-account rent) from the payer into the vault PDA.
        let rent = Rent::get()?.minimum_balance(8 + EscrowState::INIT_SPACE);
        let fund = amount.checked_add(rent).ok_or(ArbiterError::Overflow)?;
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            fund,
        )?;

        // 2) CPI escrow.initialize, signing AS the vault PDA (so it counts as the buyer's signature).
        let bump = ctx.bumps.vault;
        let seeds: &[&[u8]] = &[b"vault", reference.as_ref(), &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];
        escrow_initialize(
            CpiContext::new_with_signer(
                ctx.accounts.escrow_program.to_account_info(),
                EscrowInit {
                    buyer: ctx.accounts.vault.to_account_info(),
                    seller: ctx.accounts.seller.to_account_info(),
                    escrow: ctx.accounts.escrow.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                },
                signer,
            ),
            amount,
            reference,
            deadline,
        )?;
        Ok(())
    }

    /// The arbiter attests delivery → release to the seller. Only the configured arbiter may call.
    pub fn arbitrate_release(ctx: Context<ArbitrateRelease>, reference: Pubkey) -> Result<()> {
        require_keys_eq!(ctx.accounts.arbiter.key(), ctx.accounts.config.arbiter, ArbiterError::NotArbiter);
        let bump = ctx.bumps.vault;
        let seeds: &[&[u8]] = &[b"vault", reference.as_ref(), &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];
        escrow_release(CpiContext::new_with_signer(
            ctx.accounts.escrow_program.to_account_info(),
            EscrowRelease {
                buyer: ctx.accounts.vault.to_account_info(), // the vault signs as the escrow's buyer
                seller: ctx.accounts.seller.to_account_info(),
                escrow: ctx.accounts.escrow.to_account_info(),
            },
            signer,
        ))?;
        Ok(())
    }

    /// The arbiter refunds a failed delivery (after the escrow deadline): escrow returns the funds to
    /// the vault, then we sweep the vault back to the original payer.
    pub fn arbitrate_refund(ctx: Context<ArbitrateRefund>, reference: Pubkey) -> Result<()> {
        require_keys_eq!(ctx.accounts.arbiter.key(), ctx.accounts.config.arbiter, ArbiterError::NotArbiter);
        let bump = ctx.bumps.vault;
        let seeds: &[&[u8]] = &[b"vault", reference.as_ref(), &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];

        // 1) escrow.refund → all funds (deposit + escrow rent) back to the vault (the escrow's buyer).
        escrow_refund(CpiContext::new_with_signer(
            ctx.accounts.escrow_program.to_account_info(),
            EscrowRefund {
                buyer: ctx.accounts.vault.to_account_info(),
                escrow: ctx.accounts.escrow.to_account_info(),
            },
            signer,
        ))?;

        // 2) sweep the vault back to the original payer (the vault is System-owned; it signs via seeds).
        let lamports = ctx.accounts.vault.lamports();
        if lamports > 0 {
            transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.payer.to_account_info(),
                    },
                    signer,
                ),
                lamports,
            )?;
        }
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub arbiter: Pubkey,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(amount: u64, reference: Pubkey)]
pub struct Open<'info> {
    #[account(mut)]
    pub payer: Signer<'info>, // the human/agent funding the order

    /// CHECK: System-owned vault PDA that acts as the escrow's "buyer". Never given data.
    #[account(mut, seeds = [b"vault", reference.as_ref()], bump)]
    pub vault: UncheckedAccount<'info>,

    /// CHECK: payout destination, bound into the escrow at init
    pub seller: UncheckedAccount<'info>,

    /// CHECK: created by the escrow program via CPI; address validated against the escrow id
    #[account(
        mut,
        seeds = [b"escrow", vault.key().as_ref(), reference.as_ref()],
        bump,
        seeds::program = escrow_program.key()
    )]
    pub escrow: UncheckedAccount<'info>,

    pub escrow_program: Program<'info, EscrowProgram>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(reference: Pubkey)]
pub struct ArbitrateRelease<'info> {
    pub arbiter: Signer<'info>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,

    /// CHECK: the vault PDA = the escrow's buyer; we sign for it below
    #[account(mut, seeds = [b"vault", reference.as_ref()], bump)]
    pub vault: UncheckedAccount<'info>,

    /// CHECK: paid by the escrow on release
    #[account(mut)]
    pub seller: UncheckedAccount<'info>,

    /// CHECK: validated + closed by the escrow program
    #[account(
        mut,
        seeds = [b"escrow", vault.key().as_ref(), reference.as_ref()],
        bump,
        seeds::program = escrow_program.key()
    )]
    pub escrow: UncheckedAccount<'info>,

    pub escrow_program: Program<'info, EscrowProgram>,
}

#[derive(Accounts)]
#[instruction(reference: Pubkey)]
pub struct ArbitrateRefund<'info> {
    pub arbiter: Signer<'info>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,

    /// CHECK: the vault PDA = the escrow's buyer; we sign for it below
    #[account(mut, seeds = [b"vault", reference.as_ref()], bump)]
    pub vault: UncheckedAccount<'info>,

    /// CHECK: the original payer — receives the swept refund
    #[account(mut)]
    pub payer: UncheckedAccount<'info>,

    /// CHECK: validated + closed by the escrow program
    #[account(
        mut,
        seeds = [b"escrow", vault.key().as_ref(), reference.as_ref()],
        bump,
        seeds::program = escrow_program.key()
    )]
    pub escrow: UncheckedAccount<'info>,

    pub escrow_program: Program<'info, EscrowProgram>,
    pub system_program: Program<'info, System>,
}

#[error_code]
pub enum ArbiterError {
    #[msg("Caller is not the configured arbiter")]
    NotArbiter,
    #[msg("Arithmetic overflow")]
    Overflow,
}
