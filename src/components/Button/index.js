import React from 'react'

import './Button.css'

export const Button = ({ onClick, children, hidden}) => {
    return (
        <div className='button-container' hidden={hidden}>
            <button className='button-container-btn' onClick={onClick}>{children}</button>
        </div>
    )
}