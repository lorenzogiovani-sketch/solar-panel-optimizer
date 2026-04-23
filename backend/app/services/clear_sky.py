from abc import ABC, abstractmethod
from typing import Optional, Tuple

import pandas as pd
import pvlib


class ClearSkyStrategy(ABC):
    @abstractmethod
    def compute(
        self,
        times: pd.DatetimeIndex,
        latitude: float,
        longitude: float,
        altitude: float,
        beta_corr: Tuple[float, float],
        turbidity,
        pressure: float,
    ) -> dict:
        """
        Calcola le componenti di irradianza orizzontale clear-sky.

        Args:
            times: indice temporale con timezone
            latitude, longitude: coordinate geografiche [°]
            altitude: altitudine sito [m s.l.m.]
            beta_corr: tupla (β_A, α) coefficienti Ångström (torbidezza aerosol)
            turbidity: serie T_L di Linke (pd.Series) oppure None per default pvlib
            pressure: pressione superficiale [Pa]

        Returns:
            dict con chiavi 'ghi', 'dni', 'dhi' (pd.Series, W/m², clip ≥ 0)
        """
        ...


class REST2Strategy(ClearSkyStrategy):
    """
    Approssimazione REST2 (Gueymard 2004, Solar Energy 82 2008) via pvlib.clearsky.bird.

    REST2 e Bird (1984) condividono la stessa struttura a trasmittanze multiple per banda
    broadband: Rayleigh (T_R), gas uniformi (T_g), ozono (T_o), vapore acqueo (T_w), aerosol
    (T_a). pvlib espone Bird ma non REST2 nativamente; Bird è validato sugli stessi benchmark
    di REST2 e produce DNI sistematicamente più alto di Ineichen per cielo sereno vero.
    Conversione: AOD(λ) = β_A · λ^{−α} (legge Ångström) applicata a λ=380 nm e λ=500 nm.
    Valori di riferimento REST2: w=1.5 cm (acqua precipitabile), uo=0.3 atm-cm (ozono).
    """

    def compute(self, times, latitude, longitude, altitude, beta_corr, turbidity, pressure):
        beta_a, alpha = beta_corr if beta_corr else (0.05, 1.3)
        altitude = altitude or 0.0

        location = pvlib.location.Location(latitude, longitude, altitude=altitude)
        solpos = location.get_solarposition(times)

        airmass_rel = pvlib.atmosphere.get_relative_airmass(
            solpos['apparent_zenith'], model='kastenyoung1989'
        )
        # AOD a 380 nm e 500 nm dalla legge di Ångström: τ_a(λ) = β_A · λ^{−α}
        aod380 = beta_a * (0.38 ** (-alpha))
        aod500 = beta_a * (0.50 ** (-alpha))

        dni_extra = pvlib.irradiance.get_extra_radiation(times)

        result = pvlib.clearsky.bird(
            zenith=solpos['apparent_zenith'],
            airmass_relative=airmass_rel,
            aod380=aod380,
            aod500=aod500,
            precipitable_water=1.5,
            ozone=0.3,
            pressure=pressure,
            dni_extra=dni_extra,
        )
        return {
            'ghi': result['ghi'].clip(lower=0),
            'dni': result['dni'].clip(lower=0),
            'dhi': result['dhi'].clip(lower=0),
        }


class IneichenStrategy(ClearSkyStrategy):
    """
    Ineichen-Perez (2002) via pvlib — comportamento attuale del sistema.

    Se turbidity (T_L di Linke) è fornita, usa pvlib.clearsky.ineichen direttamente.
    Altrimenti delega a location.get_clearsky() con T_L climatologica pvlib.
    """

    def compute(self, times, latitude, longitude, altitude, beta_corr, turbidity, pressure):
        altitude = altitude or 0.0
        location = pvlib.location.Location(
            latitude, longitude, altitude=altitude, tz=times.tz
        )

        if turbidity is not None:
            solpos = location.get_solarposition(times)
            airmass_rel = pvlib.atmosphere.get_relative_airmass(
                solpos['apparent_zenith'], model='kastenyoung1989'
            )
            airmass_abs = pvlib.atmosphere.get_absolute_airmass(
                airmass_rel, pressure=pressure
            )
            result = pvlib.clearsky.ineichen(
                apparent_zenith=solpos['apparent_zenith'],
                airmass_absolute=airmass_abs,
                linke_turbidity=turbidity,
                altitude=altitude,
            )
        else:
            result = location.get_clearsky(times)

        return {
            'ghi': result['ghi'].clip(lower=0),
            'dni': result['dni'].clip(lower=0),
            'dhi': result['dhi'].clip(lower=0),
        }


def select_clear_sky_strategy(sky_condition: str) -> ClearSkyStrategy:
    """Factory: mappa la condizione di cielo alla strategia di calcolo corretta."""
    if sky_condition == 'clear':
        return REST2Strategy()
    # 'average' e 'generic' → Ineichen (comportamento attuale)
    return IneichenStrategy()
