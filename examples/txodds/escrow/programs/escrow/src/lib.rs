//! Escrow — the **settlement spine** of the demo: escrow-protected, buyer-released settlement.
//!
//! A buyer **deposits** SOL into a per-order escrow PDA; the seller is paid only when the buyer
//! **releases** (confirms delivery), and the buyer can **refund** after a deadline if the seller never
//! delivered. This is the only Rust in the kit, and it is **not optional** — every order settles here.
//!
//! **Asymmetry, stated honestly:** only the **buyer** signs `initialize` / `release` / `refund`. That
//! protects the *buyer* — funds are conditional and refundable — but the **seller has no on-chain
//! recourse** here: a buyer could take delivery and then refund after the deadline. That's fixed by the
//! sibling **arbiter** program (`../arbiter`, deployed) — a neutral 3rd signer gates settlement via the
//! vault-as-buyer pattern; the demo settles through it. See `../../contract_extension.md`.
//!
//! Security posture (from the solana-dev skill checklist):
//! - `init` (never `init_if_needed`) — no reinitialization attacks.
//! - PDA seeds include the buyer **and** the order reference — no shared-PDA "master key".
//! - `Signer` + `has_one` everywhere — only the real buyer/seller can act.
//! - `close = buyer` — secure closure returns rent and prevents account revival.
//! - Checked math on every lamport move.
//!
//! You don't fork this — you **call** it. The fork point is the service being sold
//! (`examples/txodds/server/proxy.ts`); the agent deposits / releases / refunds through this
//! program via its TS client. See ../README.md.

use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

// Program id of the live devnet deployment. Forking? Run `anchor keys sync` after your first build
// to repoint this (and Anchor.toml / the TS clients) at your own program keypair.
declare_id!("R5NWNg9eRLWWQU81Xbzz5Du1k7jTDeeT92Ty6qCeXet");

#[program]
pub mod escrow {
    use super::*;

    /// Buyer deposits `amount` lamports into a per-order escrow, with a refund `deadline`.
    /// `reference` is the Solana Pay reference that ties this escrow to one request.
    pub fn initialize(
        ctx: Context<Initialize>,
        amount: u64,
        reference: Pubkey,
        deadline: i64,
    ) -> Result<()> {
        require!(amount > 0, EscrowError::ZeroAmount);
        require!(deadline > Clock::get()?.unix_timestamp, EscrowError::DeadlineInPast);

        let escrow = &mut ctx.accounts.escrow;
        escrow.buyer = ctx.accounts.buyer.key();
        escrow.seller = ctx.accounts.seller.key();
        escrow.amount = amount;
        escrow.reference = reference;
        escrow.deadline = deadline;
        escrow.bump = ctx.bumps.escrow;

        // Move the escrowed SOL from the buyer into the escrow account (System CPI — buyer signs).
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.escrow.to_account_info(),
                },
            ),
            amount,
        )?;
        Ok(())
    }

    /// Buyer confirms delivery → pay the seller. The escrowed `amount` goes to the seller; the
    /// account is closed and its rent returned to the buyer.
    pub fn release(ctx: Context<Release>) -> Result<()> {
        let amount = ctx.accounts.escrow.amount;
        // The escrow account is program-owned, so move its lamports directly (no System CPI needed).
        **ctx.accounts.escrow.to_account_info().try_borrow_mut_lamports()? = ctx
            .accounts
            .escrow
            .to_account_info()
            .lamports()
            .checked_sub(amount)
            .ok_or(EscrowError::Overflow)?;
        **ctx.accounts.seller.try_borrow_mut_lamports()? = ctx
            .accounts
            .seller
            .lamports()
            .checked_add(amount)
            .ok_or(EscrowError::Overflow)?;
        Ok(())
        // `close = buyer` (in the Accounts struct) returns the remaining rent to the buyer.
    }

    /// Buyer reclaims the deposit after the deadline (seller never delivered). The whole balance —
    /// escrowed amount + rent — is returned to the buyer via `close = buyer`.
    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        require!(
            Clock::get()?.unix_timestamp >= ctx.accounts.escrow.deadline,
            EscrowError::BeforeDeadline
        );
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(amount: u64, reference: Pubkey)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// CHECK: only used as the payout destination on release; identity is bound into the escrow.
    pub seller: UncheckedAccount<'info>,
    #[account(
        init,
        payer = buyer,
        space = 8 + Escrow::INIT_SPACE,
        seeds = [b"escrow", buyer.key().as_ref(), reference.as_ref()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Release<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// CHECK: must match the seller bound at initialize (enforced by `has_one`).
    #[account(mut)]
    pub seller: UncheckedAccount<'info>,
    #[account(
        mut,
        close = buyer,
        has_one = buyer @ EscrowError::WrongBuyer,
        has_one = seller @ EscrowError::WrongSeller,
        seeds = [b"escrow", buyer.key().as_ref(), escrow.reference.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(
        mut,
        close = buyer,
        has_one = buyer @ EscrowError::WrongBuyer,
        seeds = [b"escrow", buyer.key().as_ref(), escrow.reference.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,
}

#[account]
#[derive(InitSpace)]
pub struct Escrow {
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub amount: u64,
    pub reference: Pubkey, // ties the escrow to one Solana Pay request
    pub deadline: i64,     // unix ts; buyer may refund at/after this
    pub bump: u8,
}

#[error_code]
pub enum EscrowError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Deadline must be in the future")]
    DeadlineInPast,
    #[msg("Refund is only allowed at or after the deadline")]
    BeforeDeadline,
    #[msg("Buyer does not match the escrow")]
    WrongBuyer,
    #[msg("Seller does not match the escrow")]
    WrongSeller,
    #[msg("Arithmetic overflow")]
    Overflow,
}
