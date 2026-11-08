use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};

use crate::errors::ErrorCode;
use crate::events::Deposited;
use crate::math;
use crate::state::Pool;

#[derive(Accounts)]
pub struct Deposit<'info> {
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
        init_if_needed,
        payer = lender,
        associated_token::mint = lp_mint,
        associated_token::authority = lender,
    )]
    pub lender_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handle_deposit(ctx: Context<Deposit>, lamports: u64) -> Result<()> {
    let pool = &ctx.accounts.pool;
    let rent_min = Rent::get()?.minimum_balance(0);
    let vault_available = ctx.accounts.vault.lamports().saturating_sub(rent_min);
    let pool_value = math::pool_value(vault_available, pool.total_principal)?;
    let shares = math::shares_for_deposit(lamports, ctx.accounts.lp_mint.supply, pool_value)?;
    require!(shares > 0, ErrorCode::ZeroShares);

    anchor_lang::system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.lender.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        ),
        lamports,
    )?;

    let bump = pool.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[b"pool", &[bump]]];
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            MintTo {
                mint: ctx.accounts.lp_mint.to_account_info(),
                to: ctx.accounts.lender_ata.to_account_info(),
                authority: ctx.accounts.pool.to_account_info(),
            },
            signer_seeds,
        ),
        shares,
    )?;

    emit!(Deposited { lender: ctx.accounts.lender.key(), lamports, shares });
    Ok(())
}
