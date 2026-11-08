use anchor_lang::prelude::*;

use crate::errors::ErrorCode;
use crate::events::Enrolled;
use crate::state::{Pool, Position};
use crate::vote::{parse_v4_header, VOTE_PROGRAM_ID};

#[derive(Accounts)]
pub struct Enroll<'info> {
    /// Node identity (must equal vote node_pubkey)
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: vote account, owner == vote program checked in constraint
    #[account(owner = VOTE_PROGRAM_ID @ ErrorCode::InvalidVoteAccount)]
    pub vote_account: UncheckedAccount<'info>,
    /// CHECK: authority PDA, seeds ["auth", vote]
    #[account(seeds = [b"auth", vote_account.key().as_ref()], bump)]
    pub auth: UncheckedAccount<'info>,
    #[account(
        init,
        payer = owner,
        space = 8 + Position::INIT_SPACE,
        seeds = [b"pos", vote_account.key().as_ref()],
        bump,
    )]
    pub position: Account<'info, Position>,
    #[account(seeds = [b"pool"], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    pub system_program: Program<'info, System>,
}

pub fn handle_enroll(ctx: Context<Enroll>, payout: Pubkey) -> Result<()> {
    let data = ctx.accounts.vote_account.try_borrow_data()?;
    let h = parse_v4_header(&data)?;
    let auth = ctx.accounts.auth.key();
    require_keys_eq!(h.authorized_withdrawer, auth, ErrorCode::WithdrawerNotPda);
    require_keys_eq!(h.node_pubkey, ctx.accounts.owner.key(), ErrorCode::NotNodeIdentity);
    require!(h.has_bls, ErrorCode::NoBls);
    require_keys_eq!(
        h.inflation_rewards_collector,
        ctx.accounts.vote_account.key(),
        ErrorCode::CollectorNotVoteAccount
    );
    drop(data);

    let pool = &ctx.accounts.pool;
    let credit_limit = (pool.default_credit_tickets as u64)
        .checked_mul(pool.ticket_lamports)
        .ok_or(ErrorCode::MathOverflow)?;

    let pos = &mut ctx.accounts.position;
    pos.vote_account = ctx.accounts.vote_account.key();
    pos.owner = ctx.accounts.owner.key();
    pos.payout = payout;
    pos.principal = 0;
    pos.fees = 0;
    pos.credit_limit = credit_limit;
    pos.topups = 0;
    pos.last_topup_epoch = u64::MAX;
    pos.enrolled_epoch = Clock::get()?.epoch;
    pos.total_repaid = 0;
    pos.bump = ctx.bumps.position;
    pos.auth_bump = ctx.bumps.auth;

    emit!(Enrolled {
        vote_account: pos.vote_account,
        owner: pos.owner,
        payout: pos.payout,
        credit_limit,
        epoch: pos.enrolled_epoch,
    });
    Ok(())
}
