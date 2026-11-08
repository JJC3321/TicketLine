use anchor_lang::prelude::*;
use crate::errors::ErrorCode;

/// Lamports the vote account must hold: rent + pending + ticket + buffer.
pub fn required(rent: u64, pending: u64, ticket: u64, buffer: u64) -> Result<u64> {
    rent.checked_add(pending)
        .and_then(|v| v.checked_add(ticket))
        .and_then(|v| v.checked_add(buffer))
        .ok_or_else(|| ErrorCode::MathOverflow.into())
}

pub fn deficit(required_lamports: u64, lamports: u64) -> u64 {
    required_lamports.saturating_sub(lamports)
}

pub fn sweepable(lamports: u64, required_lamports: u64) -> u64 {
    lamports.saturating_sub(required_lamports)
}

/// ceil(amount * fee_bps / 10_000)
pub fn fee(amount: u64, fee_bps: u16) -> Result<u64> {
    let numer = (amount as u128)
        .checked_mul(fee_bps as u128)
        .ok_or(ErrorCode::MathOverflow)?;
    let v = numer
        .checked_add(9_999)
        .ok_or(ErrorCode::MathOverflow)?
        / 10_000;
    u64::try_from(v).map_err(|_| ErrorCode::MathOverflow.into())
}

/// LP shares minted for a deposit. First depositor gets 1 share per lamport.
pub fn shares_for_deposit(lamports: u64, supply: u64, pool_value: u64) -> Result<u64> {
    if supply == 0 {
        return Ok(lamports);
    }
    let v = (lamports as u128)
        .checked_mul(supply as u128)
        .ok_or(ErrorCode::MathOverflow)?
        / (pool_value as u128);
    u64::try_from(v).map_err(|_| ErrorCode::MathOverflow.into())
}

/// Lamports redeemed for LP shares (floor, favors the pool).
pub fn lamports_for_withdraw(shares: u64, supply: u64, pool_value: u64) -> Result<u64> {
    require!(supply > 0, ErrorCode::MathOverflow);
    let v = (shares as u128)
        .checked_mul(pool_value as u128)
        .ok_or(ErrorCode::MathOverflow)?
        / (supply as u128);
    u64::try_from(v).map_err(|_| ErrorCode::MathOverflow.into())
}

/// pool_value = vault_available + outstanding principal (uncollected fees excluded).
pub fn pool_value(vault_available: u64, total_principal: u64) -> Result<u64> {
    vault_available
        .checked_add(total_principal)
        .ok_or_else(|| ErrorCode::MathOverflow.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn required_deficit_sweepable() {
        let r = required(1_000, 2_000, 3_000, 4_000).unwrap();
        assert_eq!(r, 10_000);
        assert_eq!(deficit(r, 4_000), 6_000);
        assert_eq!(deficit(r, 12_000), 0);
        assert_eq!(sweepable(15_000, r), 5_000);
        assert_eq!(sweepable(9_000, r), 0);
    }

    #[test]
    fn fee_rounds_up() {
        assert_eq!(fee(1_000_000_000, 150).unwrap(), 15_000_000);
        assert_eq!(fee(1, 1).unwrap(), 1); // ceil
        assert_eq!(fee(10_000, 1).unwrap(), 1);
        assert_eq!(fee(0, 150).unwrap(), 0);
    }

    #[test]
    fn share_math() {
        // first deposit: 1:1
        assert_eq!(shares_for_deposit(1_000, 0, 0).unwrap(), 1_000);
        // proportional
        assert_eq!(shares_for_deposit(500, 1_000, 1_000).unwrap(), 500);
        // withdraw floor favors pool
        assert_eq!(lamports_for_withdraw(1, 3, 10).unwrap(), 3);
        // round trip never exceeds pool value
        let l = lamports_for_withdraw(500, 1_500, 3_000).unwrap();
        assert_eq!(l, 1_000);
    }

    #[test]
    fn fee_and_pool_value_overflow_safe() {
        assert!(fee(u64::MAX, 10_000).is_ok());
        assert!(required(u64::MAX, 1, 0, 0).is_err());
        assert!(pool_value(u64::MAX, 1).is_err());
    }
}
