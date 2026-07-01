//! Direct escrow program: buyer deposits, buyer releases on delivery, buyer refunds after deadline.

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

        let escrow = &mut ctx.accounts.escrow;
        escrow.buyer = ctx.accounts.buyer.key();
        escrow.seller = ctx.accounts.seller.key();
        escrow.amount = amount;
        escrow.reference = reference;
        escrow.deadline = deadline;
        escrow.bump = ctx.bumps.escrow;

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

    pub fn release(ctx: Context<Release>) -> Result<()> {
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
        Ok(())
    }

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
    /// CHECK: must match the seller bound at initialize.
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
    pub reference: Pubkey,
    pub deadline: i64,
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
