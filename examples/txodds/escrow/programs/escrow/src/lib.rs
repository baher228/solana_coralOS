//! Direct escrow program.
//!
//! Buyer funds an escrow for a delivery keyed by its Solana Pay `reference`. Settlement is
//! authority-aware: either the buyer or a designated `arbiter` (the platform) can release funds to
//! the seller, and either can refund the buyer after the deadline. Once the arbiter marks the
//! delivery `approved`, refunds are blocked so a buyer cannot reclaim funds for work the platform
//! already accepted — the funds can then only move to the seller via `release`.

use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

declare_id!("R5NWNg9eRLWWQU81Xbzz5Du1k7jTDeeT92Ty6qCeXet");

#[program]
pub mod escrow {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        amount: u64,
        reference: Pubkey,
        deadline: i64,
    ) -> Result<()> {
        require!(amount > 0, EscrowError::ZeroAmount);
        require!(deadline > Clock::get()?.unix_timestamp, EscrowError::DeadlineInPast);

        let buyer = ctx.accounts.buyer.key();
        let seller = ctx.accounts.seller.key();
        let arbiter = ctx.accounts.arbiter.key();
        require!(seller != Pubkey::default(), EscrowError::InvalidSeller);
        require!(seller != buyer, EscrowError::SellerIsBuyer);
        require!(arbiter != Pubkey::default(), EscrowError::InvalidArbiter);

        let escrow_key;
        {
            let escrow = &mut ctx.accounts.escrow;
            escrow.buyer = buyer;
            escrow.seller = seller;
            escrow.arbiter = arbiter;
            escrow.amount = amount;
            escrow.reference = reference;
            escrow.deadline = deadline;
            escrow.approved = false;
            escrow.bump = ctx.bumps.escrow;
            escrow_key = escrow.key();
        }

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

        emit!(EscrowInitialized {
            escrow: escrow_key,
            buyer,
            seller,
            arbiter,
            amount,
            reference,
            deadline,
        });
        Ok(())
    }

    /// Arbiter accepts the delivery. This permanently disables refunds so the escrow can only be
    /// released to the seller — closing the window where a buyer could refund approved work.
    pub fn approve(ctx: Context<Approve>) -> Result<()> {
        require!(ctx.accounts.arbiter.is_signer, EscrowError::Unauthorized);
        let escrow = &mut ctx.accounts.escrow;
        require!(!escrow.approved, EscrowError::AlreadyApproved);
        escrow.approved = true;
        emit!(EscrowApproved { escrow: escrow.key() });
        Ok(())
    }

    /// Pay the seller and close the escrow. Callable by the buyer or the arbiter.
    pub fn release(ctx: Context<Release>) -> Result<()> {
        require!(
            ctx.accounts.buyer.is_signer || ctx.accounts.arbiter.is_signer,
            EscrowError::Unauthorized
        );
        let amount = ctx.accounts.escrow.amount;
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
        emit!(EscrowReleased {
            escrow: ctx.accounts.escrow.key(),
            seller: ctx.accounts.seller.key(),
            amount,
        });
        Ok(())
    }

    /// Return the deposit to the buyer after the deadline. Callable by the buyer or the arbiter,
    /// but only while the delivery has not been approved.
    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        require!(
            ctx.accounts.buyer.is_signer || ctx.accounts.arbiter.is_signer,
            EscrowError::Unauthorized
        );
        require!(!ctx.accounts.escrow.approved, EscrowError::AlreadyApproved);
        require!(
            Clock::get()?.unix_timestamp >= ctx.accounts.escrow.deadline,
            EscrowError::BeforeDeadline
        );
        emit!(EscrowRefunded {
            escrow: ctx.accounts.escrow.key(),
            buyer: ctx.accounts.escrow.buyer,
            amount: ctx.accounts.escrow.amount,
        });
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
    /// CHECK: settlement authority (platform). Identity is bound into the escrow; never receives funds here.
    pub arbiter: UncheckedAccount<'info>,
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
pub struct Approve<'info> {
    /// CHECK: must match the arbiter bound at initialize and must sign (checked in the handler).
    pub arbiter: UncheckedAccount<'info>,
    #[account(
        mut,
        has_one = arbiter @ EscrowError::WrongArbiter,
        seeds = [b"escrow", escrow.buyer.as_ref(), escrow.reference.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,
}

#[derive(Accounts)]
pub struct Release<'info> {
    /// CHECK: rent destination on close; must match the buyer bound at initialize.
    #[account(mut)]
    pub buyer: UncheckedAccount<'info>,
    /// CHECK: payout destination; must match the seller bound at initialize.
    #[account(mut)]
    pub seller: UncheckedAccount<'info>,
    /// CHECK: settlement authority; must match the arbiter bound at initialize.
    pub arbiter: UncheckedAccount<'info>,
    #[account(
        mut,
        close = buyer,
        has_one = buyer @ EscrowError::WrongBuyer,
        has_one = seller @ EscrowError::WrongSeller,
        has_one = arbiter @ EscrowError::WrongArbiter,
        seeds = [b"escrow", buyer.key().as_ref(), escrow.reference.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    /// CHECK: deposit destination on close; must match the buyer bound at initialize.
    #[account(mut)]
    pub buyer: UncheckedAccount<'info>,
    /// CHECK: settlement authority; must match the arbiter bound at initialize.
    pub arbiter: UncheckedAccount<'info>,
    #[account(
        mut,
        close = buyer,
        has_one = buyer @ EscrowError::WrongBuyer,
        has_one = arbiter @ EscrowError::WrongArbiter,
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
    pub arbiter: Pubkey,
    pub amount: u64,
    pub reference: Pubkey,
    pub deadline: i64,
    pub approved: bool,
    pub bump: u8,
}

#[event]
pub struct EscrowInitialized {
    pub escrow: Pubkey,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub arbiter: Pubkey,
    pub amount: u64,
    pub reference: Pubkey,
    pub deadline: i64,
}

#[event]
pub struct EscrowApproved {
    pub escrow: Pubkey,
}

#[event]
pub struct EscrowReleased {
    pub escrow: Pubkey,
    pub seller: Pubkey,
    pub amount: u64,
}

#[event]
pub struct EscrowRefunded {
    pub escrow: Pubkey,
    pub buyer: Pubkey,
    pub amount: u64,
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
    #[msg("Arbiter does not match the escrow")]
    WrongArbiter,
    #[msg("Seller must be different from the buyer")]
    SellerIsBuyer,
    #[msg("Seller address is invalid")]
    InvalidSeller,
    #[msg("Arbiter address is invalid")]
    InvalidArbiter,
    #[msg("Escrow was already approved for release")]
    AlreadyApproved,
    #[msg("Caller is not authorized to settle this escrow")]
    Unauthorized,
    #[msg("Arithmetic overflow")]
    Overflow,
}
