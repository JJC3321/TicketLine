use anchor_lang::prelude::*;

use crate::errors::ErrorCode;
use crate::events::TopUp;
use crate::math;
use crate::state::{Pool, Position};
use crate::vote::{parse_v4_header, VOTE_PROGRAM_ID};

#[derive(Accounts)]
pub struct TopUpIx<'info> {
    /// Keeper / any caller paying the tx fee
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [b"pool"], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    /// CHECK: system vault PDA
    #[account(mut, seeds = [b"vault", pool.key().as_ref()], bump = pool.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"pos", position.vote_account.as_ref()],
        bump = position.bump,
    )]
    pub position: Account<'info, Position>,
    /// CHECK: must be the position's vote account, owned by the vote program
    #[account(
        mut,
        owner = VOTE_PROGRAM_ID @ ErrorCode::InvalidVoteAccount,
        constraint = vote_account.key() == position.vote_account @ ErrorCode::InvalidVoteAccount,
    )]
    pub vote_account: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handle_top_up(ctx: Context<TopUpIx>) -> Result<()> {
    let epoch = Clock::get()?.epoch;
    let pos = &mut ctx.accounts.position;
    require!(pos.last_topup_epoch != epoch, ErrorCode::AlreadyToppedUpThisEpoch);

    let data = ctx.accounts.vote_account.try_borrow_data()?;
    let pending = parse_v4_header(&data)?.pending_delegator_rewards;
    let data_len = data.len();
    drop(data);

    let pool = &ctx.accounts.pool;
    let rent = Rent::get()?.minimum_balance(data_len);
    let required = math::required(rent, pending, pool.ticket_lamports, pool.buffer_lamports)?;
    let lamports = ctx.accounts.vote_account.lamports();
    let deficit = math::deficit(required, lamports);
    require!(deficit > 0, ErrorCode::NoDeficit);

    let fee = math::fee(deficit, pool.fee_bps)?;
    let new_debt = pos
        .principal
        .checked_add(pos.fees)
        .and_then(|v| v.checked_add(deficit))
        .and_then(|v| v.checked_add(fee))
        .ok_or(ErrorCode::MathOverflow)?;
    require!(new_debt <= pos.credit_limit, ErrorCode::CreditExceeded);

    let rent_min0 = Rent::get()?.minimum_balance(0);
    let vault_available = ctx.accounts.vault.lamports().saturating_sub(rent_min0);
    require!(deficit <= vault_available, ErrorCode::PoolIlliquid);

    let pool_key = pool.key();
    let bump = pool.vault_bump;
    let signer_seeds: &[&[&[u8]]] = &[&[b"vault", pool_key.as_ref(), &[bump]]];
    anchor_lang::system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.key(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.vote_account.to_account_info(),
            },
            signer_seeds,
        ),
        deficit,
    )?;

    pos.principal = pos.principal.checked_add(deficit).ok_or(ErrorCode::MathOverflow)?;
    pos.fees = pos.fees.checked_add(fee).ok_or(ErrorCode::MathOverflow)?;
    pos.topups = pos.topups.checked_add(1).ok_or(ErrorCode::MathOverflow)?;
    pos.last_topup_epoch = epoch;

    let pool = &mut ctx.accounts.pool;
    pool.total_principal =
        pool.total_principal.checked_add(deficit).ok_or(ErrorCode::MathOverflow)?;
    pool.total_fees_outstanding =
        pool.total_fees_outstanding.checked_add(fee).ok_or(ErrorCode::MathOverflow)?;
    pool.total_topups = pool.total_topups.checked_add(1).ok_or(ErrorCode::MathOverflow)?;

    emit!(TopUp {
        vote_account: pos.vote_account,
        amount: deficit,
        fee,
        epoch,
        principal: pos.principal,
        fees: pos.fees,
    });
    Ok(())
}
