import React from 'react'
import './Input.css'

export const Input = ({value, setValue, priceText, priceValue, balanceText, balanceValue, coinSVG, coinText, readOnly}) => {
    return (
        <div className="input-container">
            <div className="input-container--top-row">
                <div className="input-container--top-row--left">
                    {priceText}: {priceValue}
                </div>
                <div className='input-container--top-row--right'>
                    {balanceText}: {balanceValue}
                </div>
            </div>
            <div className='input-container--swap-section'>
                <div className='input-container--swap-section-container'>
                    <input type="text" readOnly={readOnly} inputMode='decimal' placeholder='0.0' className='input-container--swap-section-input' value={value} onChange={(e) => setValue(e.target.value)}></input>
                </div>
                <div className='input-container--swap-section-coin'>
                    <span className='input-container--swap-section-coin-content'>
                        {coinText}
                    </span>
                </div>
            </div>
        </div>
    )
}