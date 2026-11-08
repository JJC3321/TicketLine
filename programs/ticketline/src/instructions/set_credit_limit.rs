use anchor_lang::prelude::*;

use crate::errors::ErrorCode;
use crate::events::CreditLimitSet;
use crate::state::{Pool, Position};

#[derive(Accounts)]
pub struct SetCreditLimit<'info> {
    pub oracle: Signer<'info>,
    #[account(seeds = [b"pool"], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(mut, seeds = [b"pos", position.vote_account.as_ref()], bump = position.bump)]
    pub position: Account<'info, Position>,
}

pub fn handle_set_credit_limit(ctx: Context<SetCreditLimit>, limit: u64) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.pool.oracle,
        ctx.accounts.oracle.key(),
        ErrorCode::Unauthorized
    );
    ctx.accounts.position.credit_limit = limit;
    emit!(CreditLimitSet {
        vote_account: ctx.accounts.position.vote_account,
        credit_limit: limit,
    });
    Ok(())
}
