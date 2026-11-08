use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::solana_program::system_instruction;
use anchor_spl::token::{Mint, Token};

use crate::state::Pool;

#[derive(Accounts)]
#[instruction(fee_bps: u16, ticket_lamports: u64, buffer_lamports: u64, default_credit_tickets: u8, oracle: Pubkey)]
pub struct InitPool<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + Pool::INIT_SPACE,
        seeds = [b"pool"],
        bump,
    )]
    pub pool: Account<'info, Pool>,
    /// CHECK: system-owned zero-data lamport vault, seeds ["vault", pool]; created in handler
    #[account(mut, seeds = [b"vault", pool.key().as_ref()], bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(
        init,
        payer = admin,
        seeds = [b"lp", pool.key().as_ref()],
        bump,
        mint::decimals = 9,
        mint::authority = pool,
    )]
    pub lp_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handle_init_pool(
    ctx: Context<InitPool>,
    fee_bps: u16,
    ticket_lamports: u64,
    buffer_lamports: u64,
    default_credit_tickets: u8,
    oracle: Pubkey,
) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    pool.admin = ctx.accounts.admin.key();
    pool.oracle = oracle;
    pool.lp_mint = ctx.accounts.lp_mint.key();
    pool.fee_bps = fee_bps;
    pool.ticket_lamports = ticket_lamports;
    pool.buffer_lamports = buffer_lamports;
    pool.default_credit_tickets = default_credit_tickets;
    pool.total_principal = 0;
    pool.total_fees_outstanding = 0;
    pool.total_fees_earned = 0;
    pool.total_topups = 0;
    pool.bump = ctx.bumps.pool;
    pool.vault_bump = ctx.bumps.vault;
    pool.lp_bump = ctx.bumps.lp_mint;

    // create the vault as a system-owned zero-data account holding exactly rent_min(0)
    let rent_min = Rent::get()?.minimum_balance(0);
    let pool_key = pool.key();
    let bump = pool.vault_bump;
    invoke_signed(
        &system_instruction::create_account(
            &ctx.accounts.admin.key(),
            &ctx.accounts.vault.key(),
            rent_min,
            0,
            &anchor_lang::solana_program::system_program::ID,
        ),
        &[
            ctx.accounts.admin.to_account_info(),
            ctx.accounts.vault.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        &[&[b"vault", pool_key.as_ref(), &[bump]]],
    )?;
    Ok(())
}
