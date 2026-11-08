use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount};

use crate::errors::ErrorCode;
use crate::events::Withdrawn;
use crate::math;
use crate::state::Pool;

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub lender: Signer<'info>,
    #[account(mut, seeds = [b"pool"], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    /// CHECK: system vault PDA
    #[account(mut, seeds = [b"vault", pool.key().as_ref()], bump = pool.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(mut, seeds = [b"lp", pool.key().as_ref()], bump = pool.lp_bump)]
    pub lp_mint: Account<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = lp_mint,
        associated_token::authority = lender,
    )]
    pub lender_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handle_withdraw(ctx: Context<Withdraw>, shares: u64) -> Result<()> {
    let pool = &ctx.accounts.pool;
    let rent_min = Rent::get()?.minimum_balance(0);
    let vault_available = ctx.accounts.vault.lamports().saturating_sub(rent_min);
    let pool_value = math::pool_value(vault_available, pool.total_principal)?;
    let lamports =
        math::lamports_for_withdraw(shares, ctx.accounts.lp_mint.supply, pool_value)?;
    require!(lamports <= vault_available, ErrorCode::PoolIlliquid);

    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Burn {
                mint: ctx.accounts.lp_mint.to_account_info(),
                from: ctx.accounts.lender_ata.to_account_info(),
                authority: ctx.accounts.lender.to_account_info(),
            },
        ),
        shares,
    )?;

    let pool_key = pool.key();
    let bump = pool.vault_bump;
    let signer_seeds: &[&[&[u8]]] = &[&[b"vault", pool_key.as_ref(), &[bump]]];
    anchor_lang::system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.key(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.lender.to_account_info(),
            },
            signer_seeds,
        ),
        lamports,
    )?;

    emit!(Withdrawn { lender: ctx.accounts.lender.key(), shares, lamports });
    Ok(())
}
