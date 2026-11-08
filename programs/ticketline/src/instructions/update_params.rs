use anchor_lang::prelude::*;
use crate::errors::ErrorCode;
use crate::state::Pool;

#[derive(Accounts)]
pub struct UpdateParams<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [b"pool"], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
}

pub fn handle_update_params(
    ctx: Context<UpdateParams>,
    fee_bps: Option<u16>,
    ticket_lamports: Option<u64>,
    buffer_lamports: Option<u64>,
    default_credit_tickets: Option<u8>,
    oracle: Option<Pubkey>,
) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    require_keys_eq!(pool.admin, ctx.accounts.admin.key(), ErrorCode::Unauthorized);
    if let Some(v) = fee_bps { pool.fee_bps = v; }
    if let Some(v) = ticket_lamports { pool.ticket_lamports = v; }
    if let Some(v) = buffer_lamports { pool.buffer_lamports = v; }
    if let Some(v) = default_credit_tickets { pool.default_credit_tickets = v; }
    if let Some(v) = oracle { pool.oracle = v; }
    Ok(())
}
